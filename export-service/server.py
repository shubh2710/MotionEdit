"""
Local FFmpeg Export Service
Runs alongside the browser video editor to provide fast, hardware-accelerated export.
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sse_starlette.sse import EventSourceResponse

from timeline_to_ffmpeg import build_ffmpeg_command, detect_encoder

app = FastAPI(title="Video Export Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS: dict[str, dict] = {}
TEMP_ROOT = Path(tempfile.gettempdir()) / "video-export-service"
TEMP_ROOT.mkdir(exist_ok=True)

ENCODER = "libx264"
FFMPEG_PATH = "ffmpeg"


def find_ffmpeg() -> str:
    for name in ("ffmpeg", "ffmpeg.exe"):
        path = shutil.which(name)
        if path:
            return path
    return "ffmpeg"


def check_ffmpeg_available() -> bool:
    try:
        subprocess.run(
            [FFMPEG_PATH, "-version"],
            capture_output=True, timeout=5,
        )
        return True
    except Exception:
        return False


@app.on_event("startup")
async def startup():
    global FFMPEG_PATH, ENCODER
    FFMPEG_PATH = find_ffmpeg()
    if not check_ffmpeg_available():
        print("[WARN] FFmpeg not found on PATH. Export will fail.")
        print("       Install FFmpeg: https://ffmpeg.org/download.html")
    else:
        ENCODER = detect_encoder(FFMPEG_PATH)
        print(f"[INFO] FFmpeg found: {FFMPEG_PATH}")
        print(f"[INFO] Selected encoder: {ENCODER}")


@app.get("/health")
async def health():
    ffmpeg_ok = check_ffmpeg_available()
    return {
        "status": "ok" if ffmpeg_ok else "ffmpeg_missing",
        "encoder": ENCODER,
        "ffmpeg": FFMPEG_PATH,
        "ffmpeg_available": ffmpeg_ok,
    }


@app.post("/export")
async def start_export(
    timeline: str = Form(...),
    files: list[UploadFile] = File(default=[]),
):
    job_id = uuid.uuid4().hex[:12]
    job_dir = TEMP_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    media_dir = job_dir / "media"
    media_dir.mkdir(exist_ok=True)

    try:
        timeline_data = json.loads(timeline)
    except json.JSONDecodeError as e:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, f"Invalid timeline JSON: {e}")

    file_map: dict[str, str] = {}
    for f in files:
        safe_name = f.filename.replace("/", "_").replace("\\", "_")
        dest = media_dir / safe_name
        with open(dest, "wb") as out:
            content = await f.read()
            out.write(content)
        file_map[f.filename] = str(dest)
        file_map[safe_name] = str(dest)

    print(f"[{job_id}] Received {len(files)} file(s): {list(file_map.keys())}")
    clips_info = [(c.get("sourcePath",""), c.get("sourceName","")) for c in timeline_data.get("clips", []) if c.get("type") != "blank"]
    print(f"[{job_id}] Timeline clips sourcePaths: {clips_info}")

    output_path = job_dir / "output.mp4"
    progress_path = job_dir / "progress.log"

    try:
        cmd = build_ffmpeg_command(
            timeline_data, file_map, str(output_path),
            FFMPEG_PATH, ENCODER, str(progress_path),
        )
    except Exception as e:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, f"Failed to build FFmpeg command: {e}")

    JOBS[job_id] = {
        "status": "running",
        "dir": str(job_dir),
        "output": str(output_path),
        "progress_file": str(progress_path),
        "command": cmd,
        "pid": None,
        "start_time": time.time(),
        "error": None,
    }

    asyncio.create_task(_run_ffmpeg(job_id, cmd))

    return {"job_id": job_id, "status": "started"}


async def _run_ffmpeg(job_id: str, cmd: list[str]):
    job = JOBS.get(job_id)
    if not job:
        return

    try:
        print(f"[{job_id}] Running: {' '.join(cmd[:6])}...")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        job["pid"] = proc.pid

        _, stderr = await proc.communicate()

        if proc.returncode == 0 and os.path.exists(job["output"]):
            job["status"] = "done"
            size_mb = os.path.getsize(job["output"]) / 1024 / 1024
            elapsed = time.time() - job["start_time"]
            print(f"[{job_id}] Done: {size_mb:.1f} MB in {elapsed:.1f}s")
        else:
            err_text = stderr.decode(errors="replace")[-500:] if stderr else "Unknown error"
            print(f"[{job_id}] FFmpeg failed (code {proc.returncode}): {err_text[:200]}")

            # Retry with libx264 if hardware encoder failed
            current_encoder = None
            for i, arg in enumerate(cmd):
                if arg == "-c:v" and i + 1 < len(cmd):
                    current_encoder = cmd[i + 1]
                    break

            if current_encoder and current_encoder != "libx264":
                print(f"[{job_id}] Retrying with libx264 fallback...")
                fallback_cmd = _build_fallback_cmd(cmd, current_encoder)
                job["status"] = "running"
                job["start_time"] = time.time()

                proc2 = await asyncio.create_subprocess_exec(
                    *fallback_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                job["pid"] = proc2.pid
                _, stderr2 = await proc2.communicate()

                if proc2.returncode == 0 and os.path.exists(job["output"]):
                    job["status"] = "done"
                    size_mb = os.path.getsize(job["output"]) / 1024 / 1024
                    elapsed = time.time() - job["start_time"]
                    print(f"[{job_id}] Done (libx264 fallback): {size_mb:.1f} MB in {elapsed:.1f}s")
                else:
                    job["status"] = "error"
                    err2 = stderr2.decode(errors="replace")[-500:] if stderr2 else err_text
                    job["error"] = err2
                    print(f"[{job_id}] Fallback also failed: {err2[:200]}")
            else:
                job["status"] = "error"
                job["error"] = err_text

    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
        print(f"[{job_id}] Exception: {e}")


def _build_fallback_cmd(cmd: list[str], hw_encoder: str) -> list[str]:
    """Replace a hardware encoder with libx264 and adjust flags."""
    fallback = list(cmd)
    hw_flags = {
        "h264_nvenc": ["-preset", "-rc", "-cq", "-b:v", "-maxrate"],
        "h264_qsv": ["-preset", "-global_quality"],
        "h264_amf": ["-quality", "-rc", "-qp_i", "-qp_p", "-b:v"],
    }
    flags_to_remove = hw_flags.get(hw_encoder, [])

    i = 0
    while i < len(fallback):
        if fallback[i] == "-c:v" and i + 1 < len(fallback) and fallback[i + 1] == hw_encoder:
            fallback[i + 1] = "libx264"
            i += 2
        elif fallback[i] in flags_to_remove and i + 1 < len(fallback):
            fallback.pop(i)
            fallback.pop(i)
        else:
            i += 1

    # Insert libx264 defaults after -c:v libx264
    for i, arg in enumerate(fallback):
        if arg == "-c:v" and i + 1 < len(fallback) and fallback[i + 1] == "libx264":
            fallback.insert(i + 2, "-preset")
            fallback.insert(i + 3, "fast")
            fallback.insert(i + 4, "-crf")
            fallback.insert(i + 5, "18")
            break

    return fallback


PROGRESS_RE = re.compile(
    r"frame=\s*(\d+).*?fps=\s*([\d.]+).*?speed=\s*([\d.]+)x",
    re.DOTALL,
)


def _parse_progress(progress_file: str) -> dict:
    """Parse FFmpeg's -progress file for latest metrics."""
    result = {"frame": 0, "fps": 0.0, "speed": 0.0, "out_time": "00:00:00.00"}
    if not os.path.exists(progress_file):
        return result

    try:
        with open(progress_file, "r") as f:
            content = f.read()
    except Exception:
        return result

    for line in content.strip().split("\n"):
        line = line.strip()
        if line.startswith("frame="):
            try:
                result["frame"] = int(line.split("=", 1)[1].strip())
            except ValueError:
                pass
        elif line.startswith("fps="):
            try:
                result["fps"] = float(line.split("=", 1)[1].strip())
            except ValueError:
                pass
        elif line.startswith("speed="):
            val = line.split("=", 1)[1].strip().rstrip("x")
            try:
                result["speed"] = float(val)
            except ValueError:
                pass
        elif line.startswith("out_time="):
            result["out_time"] = line.split("=", 1)[1].strip()

    return result


@app.get("/export/{job_id}/progress")
async def export_progress(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    async def event_generator():
        while True:
            current = JOBS.get(job_id)
            if not current:
                yield {"event": "error", "data": json.dumps({"error": "Job disappeared"})}
                break

            progress = _parse_progress(current["progress_file"])
            elapsed = time.time() - current["start_time"]

            payload = {
                "status": current["status"],
                "frame": progress["frame"],
                "fps": progress["fps"],
                "speed": progress["speed"],
                "out_time": progress["out_time"],
                "elapsed_s": round(elapsed, 1),
            }

            if current["status"] == "done":
                size_mb = 0
                if os.path.exists(current["output"]):
                    size_mb = round(os.path.getsize(current["output"]) / 1024 / 1024, 1)
                payload["size_mb"] = size_mb
                yield {"event": "done", "data": json.dumps(payload)}
                break

            if current["status"] == "error":
                payload["error"] = current.get("error", "Unknown error")
                yield {"event": "error", "data": json.dumps(payload)}
                break

            yield {"event": "progress", "data": json.dumps(payload)}
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


@app.get("/export/{job_id}/download")
async def download_export(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "done":
        raise HTTPException(400, f"Job not ready: {job['status']}")
    if not os.path.exists(job["output"]):
        raise HTTPException(404, "Output file not found")

    return FileResponse(
        job["output"],
        media_type="video/mp4",
        filename=f"export_{job_id}.mp4",
    )


@app.delete("/export/{job_id}")
async def cleanup_export(job_id: str):
    job = JOBS.pop(job_id, None)
    if not job:
        raise HTTPException(404, "Job not found")

    job_dir = job.get("dir")
    if job_dir and os.path.exists(job_dir):
        shutil.rmtree(job_dir, ignore_errors=True)

    return {"status": "cleaned"}


if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("  Video Export Service")
    print("  http://localhost:9876")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=9876, log_level="info")
