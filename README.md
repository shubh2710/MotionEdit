# Desktop Video Editor

A full-featured desktop video editor built with Electron, React, TypeScript, and FFmpeg.

## Features

- **Media Import** - Drag & drop or file picker for video, audio, and image files
- **Multi-track Timeline** - Visual timeline with multiple video and audio tracks
- **Trim & Split** - Trim clips by dragging handles, split at playhead (Ctrl+B)
- **Clip Movement** - Drag clips to reposition on the timeline
- **Speed Control** - Adjust playback speed from 0.25x to 4x
- **Volume Control** - Per-clip volume adjustment
- **Video Preview** - Real-time preview synced with timeline
- **Export** - Export timeline as a single video with configurable resolution, FPS, and quality
- **Undo/Redo** - Full undo/redo support (Ctrl+Z / Ctrl+Y)
- **Dark Mode** - Professional dark UI theme
- **Resizable Panels** - Drag to resize media library, properties, and timeline panels

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause |
| `Ctrl+B` | Split clip at playhead |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Delete` | Delete selected clips |
| `Escape` | Clear selection |
| `+` / `-` | Zoom in / out |

## Prerequisites

- **Node.js** >= 18
- **FFmpeg** installed and available in PATH (required for export functionality)

## Getting Started

```bash
# Install dependencies
npm install

# Run in browser (development)
npm run dev

# Run as Electron desktop app
npm run electron:dev

# Build for production
npm run electron:build
```

## Architecture

```
desktop-video-editor/
├── electron/           # Electron main process
│   ├── main.cjs        # Window management, IPC handlers
│   └── preload.cjs     # Context bridge for renderer
├── backend/            # FFmpeg processing service
│   └── ffmpeg-service.cjs
├── src/
│   ├── components/     # Shared UI components
│   │   ├── TitleBar.tsx
│   │   ├── Toolbar.tsx
│   │   ├── PropertiesPanel.tsx
│   │   └── ExportModal.tsx
│   ├── features/
│   │   ├── media/      # Media library panel
│   │   ├── player/     # Video preview player
│   │   └── timeline/   # Timeline editor
│   ├── store/          # Zustand state management
│   ├── hooks/          # Custom React hooks
│   └── utils/          # Types and helpers
└── package.json
```

## Tech Stack

- **Electron** - Desktop app shell
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **FFmpeg** - Video processing
