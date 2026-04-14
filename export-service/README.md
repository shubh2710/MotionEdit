# Local FFmpeg Export Service

A lightweight Python service that runs alongside the browser video editor to provide fast, hardware-accelerated video export via native FFmpeg.

## Prerequisites

1. **Python 3.10+**
2. **FFmpeg** installed and available on your PATH
   - Windows: `winget install ffmpeg` or download from https://ffmpeg.org/download.html
   - Mac: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`

## Setup

```bash
cd export-service
pip install -r requirements.txt
```

## Run

```bash
python server.py
```

The service starts on `http://localhost:9876`. The browser editor auto-detects it and enables the "Local FFmpeg Export" option in the export dialog.

## How It Works

1. The browser sends the timeline (clips, transitions, overlays, settings) plus the source media files to this service.
2. The service translates the timeline into an FFmpeg filter_complex command.
3. FFmpeg runs natively with hardware acceleration (NVENC/QSV/AMF) if available, otherwise falls back to CPU (libx264).
4. Real-time progress is streamed back to the browser via Server-Sent Events.
5. The finished MP4 is downloaded back to the browser for saving.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Check if service is running, returns encoder info |
| POST | `/export` | Start an export job (multipart: timeline JSON + media files) |
| GET | `/export/{id}/progress` | SSE stream of encoding progress |
| GET | `/export/{id}/download` | Download the finished MP4 |
| DELETE | `/export/{id}` | Clean up temp files for a job |
