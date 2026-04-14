"""
Translates the browser editor's timeline JSON into FFmpeg command-line arguments.
Supports clips, transitions, text overlays, image overlays, speed changes,
audio mixing, and hardware-accelerated encoding.
"""

import subprocess
from pathlib import Path

TRANSITION_MAP = {
    "fade": "fade",
    "crossDissolve": "fade",
    "slideLeft": "wipeleft",
    "slideRight": "wiperight",
    "slideUp": "slideup",
    "slideDown": "slidedown",
    "zoom": "smoothup",
    "blur": "fade",
    "wipe": "wipeleft",
}

RESOLUTION_MAP = {
    "1920x1080": (1920, 1080),
    "1280x720": (1280, 720),
    "854x480": (854, 480),
    "640x360": (640, 360),
}

BITRATE_MAP = {
    "high": "8M",
    "medium": "4M",
    "low": "2M",
}


def detect_encoder(ffmpeg_path: str = "ffmpeg") -> str:
    """Probe for the best available H.264 encoder."""
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=10,
        )
        output = result.stdout
    except Exception:
        return "libx264"

    for encoder in ("h264_nvenc", "h264_qsv", "h264_amf"):
        if encoder in output:
            return encoder
    return "libx264"


def _clip_duration(clip: dict) -> float:
    return (clip["end"] - clip["start"]) / clip.get("speed", 1.0)


def build_ffmpeg_command(
    timeline: dict,
    file_map: dict[str, str],
    output_path: str,
    ffmpeg_path: str = "ffmpeg",
    encoder: str = "libx264",
    progress_path: str | None = None,
) -> list[str]:
    """
    Build a complete FFmpeg command from the editor timeline.

    Args:
        timeline: The timeline JSON from the browser editor.
        file_map: Maps original filenames to local file paths.
        output_path: Where to write the output MP4.
        ffmpeg_path: Path to the ffmpeg binary.
        encoder: Video encoder to use (h264_nvenc, h264_qsv, libx264, etc.).
        progress_path: Path for FFmpeg's -progress output.

    Returns:
        A list of command-line arguments ready for subprocess.
    """
    clips = timeline.get("clips", [])
    tracks = timeline.get("tracks", [])
    transitions = timeline.get("transitions", [])
    text_overlays = timeline.get("textOverlays", [])
    image_overlays = timeline.get("imageOverlays", [])
    settings = timeline.get("settings", {})

    resolution = settings.get("resolution", "1920x1080")
    w, h = RESOLUTION_MAP.get(resolution, (1920, 1080))
    fps = settings.get("fps", 30)
    quality = settings.get("quality", "medium")
    bitrate = BITRATE_MAP.get(quality, "4M")

    sorted_clips = sorted(clips, key=lambda c: c.get("offset", 0))

    video_clips = [c for c in sorted_clips if c.get("type") in ("video", "image") and c.get("type") != "blank"]
    audio_clips = [c for c in sorted_clips if c.get("type") in ("video", "audio") and c.get("type") != "blank"]

    total_duration = 0
    for c in sorted_clips:
        clip_end = c["offset"] + _clip_duration(c)
        total_duration = max(total_duration, clip_end)

    if total_duration <= 0:
        raise ValueError("Timeline is empty")

    # --- Build inputs ---
    input_args: list[str] = []
    input_index_map: dict[str, int] = {}
    input_counter = 0

    source_paths = set()
    for c in sorted_clips:
        if c.get("type") == "blank":
            continue
        sp = c.get("sourcePath", "") or c.get("sourceName", "")
        if sp and sp not in source_paths:
            source_paths.add(sp)
            local_path = _resolve_path(sp, file_map)
            if local_path:
                input_args.extend(["-i", local_path])
                input_index_map[sp] = input_counter
                input_counter += 1

    for io in image_overlays:
        src = io.get("src", "") or io.get("name", "")
        if src and src not in source_paths:
            source_paths.add(src)
            local_path = _resolve_path(src, file_map)
            if local_path:
                input_args.extend(["-i", local_path])
                input_index_map[src] = input_counter
                input_counter += 1

    if input_counter == 0:
        raise ValueError("No valid media inputs found")

    # --- Build filter_complex ---
    filters: list[str] = []
    label_counter = [0]

    def next_label(prefix: str = "v") -> str:
        label_counter[0] += 1
        return f"{prefix}{label_counter[0]}"

    # Step 1: Create individual clip streams
    clip_labels: dict[str, str] = {}

    for c in video_clips:
        sp = c.get("sourcePath", "") or c.get("sourceName", "")
        idx = input_index_map.get(sp)
        if idx is None:
            continue

        clip_id = c["id"]
        start = c.get("start", 0)
        speed = c.get("speed", 1.0)
        dur = _clip_duration(c)
        lbl = next_label("clip")

        if c.get("type") == "image":
            filters.append(
                f"[{idx}:v]loop=loop={int(dur * fps)}:size=1:start=0,"
                f"setpts=PTS-STARTPTS,scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}"
                f"[{lbl}]"
            )
        else:
            trim_filter = f"[{idx}:v]trim=start={start:.4f}:duration={dur * speed:.4f},setpts=PTS-STARTPTS"
            if abs(speed - 1.0) > 0.01:
                trim_filter += f",setpts=PTS/{speed:.4f}"
            trim_filter += (
                f",scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps}"
                f"[{lbl}]"
            )
            filters.append(trim_filter)

        clip_labels[clip_id] = lbl

    # Step 2: Build the video timeline with transitions
    if not clip_labels:
        filters.append(f"color=c=black:s={w}x{h}:d={total_duration:.4f}:r={fps}[vbase]")
        current_video = "vbase"
    else:
        transition_map = {}
        for tr in transitions:
            key = (tr.get("fromClipId"), tr.get("toClipId"))
            transition_map[key] = tr

        ordered_clip_ids = [c["id"] for c in video_clips if c["id"] in clip_labels]

        if len(ordered_clip_ids) == 0:
            filters.append(f"color=c=black:s={w}x{h}:d={total_duration:.4f}:r={fps}[vbase]")
            current_video = "vbase"
        elif len(ordered_clip_ids) == 1:
            cid = ordered_clip_ids[0]
            clip = next(c for c in video_clips if c["id"] == cid)
            gap_before = clip["offset"]
            gap_after = total_duration - (clip["offset"] + _clip_duration(clip))

            current_video = clip_labels[cid]

            if gap_before > 0.02:
                gap_lbl = next_label("gap")
                filters.append(f"color=c=black:s={w}x{h}:d={gap_before:.4f}:r={fps}[{gap_lbl}]")
                merged = next_label("mg")
                filters.append(f"[{gap_lbl}][{current_video}]concat=n=2:v=1:a=0[{merged}]")
                current_video = merged

            if gap_after > 0.02:
                gap_lbl = next_label("gap")
                filters.append(f"color=c=black:s={w}x{h}:d={gap_after:.4f}:r={fps}[{gap_lbl}]")
                merged = next_label("mg")
                filters.append(f"[{current_video}][{gap_lbl}]concat=n=2:v=1:a=0[{merged}]")
                current_video = merged
        else:
            # Build timeline by concatenating clips with transitions or gaps
            current_video = clip_labels[ordered_clip_ids[0]]
            first_clip = next(c for c in video_clips if c["id"] == ordered_clip_ids[0])
            running_time = _clip_duration(first_clip)

            gap_before = first_clip["offset"]
            if gap_before > 0.02:
                gap_lbl = next_label("gap")
                filters.append(f"color=c=black:s={w}x{h}:d={gap_before:.4f}:r={fps}[{gap_lbl}]")
                merged = next_label("mg")
                filters.append(f"[{gap_lbl}][{current_video}]concat=n=2:v=1:a=0[{merged}]")
                current_video = merged
                running_time += gap_before

            for i in range(1, len(ordered_clip_ids)):
                prev_id = ordered_clip_ids[i - 1]
                curr_id = ordered_clip_ids[i]
                prev_clip = next(c for c in video_clips if c["id"] == prev_id)
                curr_clip = next(c for c in video_clips if c["id"] == curr_id)

                tr = transition_map.get((prev_id, curr_id))
                next_lbl = clip_labels[curr_id]
                next_dur = _clip_duration(curr_clip)

                if tr:
                    tr_dur = min(tr["duration"], running_time * 0.9, next_dur * 0.9)
                    xfade_type = TRANSITION_MAP.get(tr["type"], "fade")
                    offset = max(0, running_time - tr_dur)
                    merged = next_label("xf")
                    filters.append(
                        f"[{current_video}][{next_lbl}]xfade=transition={xfade_type}"
                        f":duration={tr_dur:.4f}:offset={offset:.4f}[{merged}]"
                    )
                    current_video = merged
                    running_time = offset + next_dur
                else:
                    expected_start = curr_clip["offset"]
                    gap = expected_start - running_time if gap_before > 0 else curr_clip["offset"] - (prev_clip["offset"] + _clip_duration(prev_clip))

                    if gap < -0.01:
                        gap = 0

                    if gap > 0.02:
                        gap_lbl = next_label("gap")
                        filters.append(f"color=c=black:s={w}x{h}:d={gap:.4f}:r={fps}[{gap_lbl}]")
                        merged = next_label("mg")
                        filters.append(f"[{current_video}][{gap_lbl}]concat=n=2:v=1:a=0[{merged}]")
                        current_video = merged
                        running_time += gap

                    merged = next_label("ct")
                    filters.append(f"[{current_video}][{next_lbl}]concat=n=2:v=1:a=0[{merged}]")
                    current_video = merged
                    running_time += next_dur

            gap_end = total_duration - running_time
            if gap_end > 0.02:
                gap_lbl = next_label("gap")
                filters.append(f"color=c=black:s={w}x{h}:d={gap_end:.4f}:r={fps}[{gap_lbl}]")
                merged = next_label("mg")
                filters.append(f"[{current_video}][{gap_lbl}]concat=n=2:v=1:a=0[{merged}]")
                current_video = merged

    # Step 3: Image overlays
    for io in image_overlays:
        src = io.get("src", "") or io.get("name", "")
        idx = input_index_map.get(src)
        if idx is None:
            continue

        x_pct = io.get("x", 0)
        y_pct = io.get("y", 0)
        w_pct = io.get("width", 10)
        h_pct = io.get("height", 10)
        opacity = io.get("opacity", 1.0)
        start_t = io.get("startTime", 0)
        end_t = io.get("endTime", total_duration)

        ow = max(1, int(w * w_pct / 100))
        oh = max(1, int(h * h_pct / 100))
        ox = int(w * x_pct / 100)
        oy = int(h * y_pct / 100)

        img_lbl = next_label("img")
        alpha_filter = f",colorchannelmixer=aa={opacity:.2f}" if opacity < 0.99 else ""
        filters.append(
            f"[{idx}:v]scale={ow}:{oh},format=rgba{alpha_filter}[{img_lbl}]"
        )

        merged = next_label("ov")
        enable = f"between(t,{start_t:.4f},{end_t:.4f})"
        filters.append(
            f"[{current_video}][{img_lbl}]overlay={ox}:{oy}:enable='{enable}'[{merged}]"
        )
        current_video = merged

    # Step 4: Text overlays via drawtext
    for to in text_overlays:
        text = to.get("text", "").replace("'", "'\\''").replace(":", "\\:")
        if not text:
            continue

        style = to.get("style", {})
        x_pct = to.get("x", 50)
        y_pct = to.get("y", 50)
        start_t = to.get("startTime", 0)
        end_t = to.get("endTime", total_duration)
        font_size = style.get("fontSize", 48)
        color = style.get("color", "#ffffff")
        font = style.get("fontFamily", "Arial")
        bold = style.get("bold", False)

        scaled_size = int(font_size * (h / 1080))
        x_pos = f"w*{x_pct / 100:.4f}-tw/2"
        y_pos = f"h*{y_pct / 100:.4f}-th/2"

        stroke_w = style.get("strokeWidth", 0)
        stroke_c = style.get("strokeColor", "#000000")

        dt = f"drawtext=text='{text}':fontsize={scaled_size}:fontcolor={color}"
        dt += f":x={x_pos}:y={y_pos}:fontfile=''"
        if bold:
            dt += f":font='{font} Bold'"
        else:
            dt += f":font='{font}'"
        if stroke_w > 0:
            dt += f":borderw={stroke_w}:bordercolor={stroke_c}"

        enable = f"between(t\\,{start_t:.4f}\\,{end_t:.4f})"
        dt += f":enable='{enable}'"

        merged = next_label("txt")
        filters.append(f"[{current_video}]{dt}[{merged}]")
        current_video = merged

    # Step 5: Audio mix
    audio_parts: list[str] = []
    audio_labels: list[str] = []

    for c in audio_clips:
        sp = c.get("sourcePath", "") or c.get("sourceName", "")
        idx = input_index_map.get(sp)
        if idx is None:
            continue

        track_idx = c.get("track", 0)
        track = tracks[track_idx] if track_idx < len(tracks) else None
        if track and track.get("muted"):
            continue

        start = c.get("start", 0)
        speed = c.get("speed", 1.0)
        dur = _clip_duration(c)
        offset = c.get("offset", 0)
        volume = c.get("audioVolume", 1.0)

        a_lbl = next_label("aud")
        a_filter = f"[{idx}:a]atrim=start={start:.4f}:duration={dur * speed:.4f},asetpts=PTS-STARTPTS"

        if abs(speed - 1.0) > 0.01:
            if speed <= 2.0:
                a_filter += f",atempo={speed:.4f}"
            else:
                a_filter += f",atempo=2.0,atempo={speed / 2.0:.4f}"

        a_filter += f",volume={volume:.2f}"

        if offset > 0.01:
            delay_ms = int(offset * 1000)
            a_filter += f",adelay={delay_ms}|{delay_ms}"

        a_filter += f"[{a_lbl}]"
        filters.append(a_filter)
        audio_labels.append(f"[{a_lbl}]")

    has_audio = len(audio_labels) > 0
    audio_output = None

    if has_audio:
        if len(audio_labels) == 1:
            audio_output = audio_labels[0].strip("[]")
        else:
            amix_lbl = next_label("amx")
            mix_inputs = "".join(audio_labels)
            filters.append(
                f"{mix_inputs}amix=inputs={len(audio_labels)}:duration=longest"
                f":dropout_transition=0[{amix_lbl}]"
            )
            audio_output = amix_lbl

    # --- Assemble command ---
    filter_str = ";\n".join(filters)

    cmd: list[str] = [ffmpeg_path, "-y"]

    if progress_path:
        cmd.extend(["-progress", progress_path, "-nostats"])

    cmd.extend(input_args)
    cmd.extend(["-filter_complex", filter_str])

    cmd.extend(["-map", f"[{current_video}]"])
    if has_audio and audio_output:
        cmd.extend(["-map", f"[{audio_output}]"])

    # Video encoding
    cmd.extend(["-c:v", encoder])
    if encoder == "h264_nvenc":
        cmd.extend(["-preset", "fast", "-rc", "vbr", "-cq", "20", "-b:v", bitrate, "-maxrate", bitrate])
    elif encoder == "h264_qsv":
        cmd.extend(["-preset", "fast", "-global_quality", "20"])
    elif encoder == "h264_amf":
        cmd.extend(["-quality", "speed", "-rc", "vbr_latency", "-qp_i", "20", "-qp_p", "20", "-b:v", bitrate])
    else:
        cmd.extend(["-preset", "fast", "-crf", "18"])

    cmd.extend(["-r", str(fps), "-s", f"{w}x{h}", "-pix_fmt", "yuv420p"])

    if has_audio and audio_output:
        cmd.extend(["-c:a", "aac", "-b:a", "192k"])

    cmd.extend(["-t", f"{total_duration:.4f}"])
    cmd.append(output_path)

    return cmd


def _resolve_path(source: str, file_map: dict[str, str]) -> str | None:
    """Resolve a source path/name to a local file path."""
    if source in file_map:
        return file_map[source]

    for key, val in file_map.items():
        if source.endswith(key) or key.endswith(source):
            return val
        base = Path(key).stem
        if base in source or source in base:
            return val

    name_only = Path(source).name if "/" in source or "\\" in source else source
    if name_only in file_map:
        return file_map[name_only]

    return None
