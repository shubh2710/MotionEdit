import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { formatTime, computeEffectiveVolume } from '../../utils/helpers';
import {
  renderTextOverlay, renderImageOverlay, renderBlankClip,
  renderOverlayBoundingBox, renderSnapGuides, renderTransition,
  preloadOverlayImages, loadImage,
} from '../../utils/overlayRenderer';
import { Clip } from '../../utils/types';

const FRAME_EPS = 0.01;

function clipEnd(c: Clip): number {
  return c.offset + (c.end - c.start) / c.speed;
}

function findVisualClipAt(clips: Clip[], tracks: { type: string }[], time: number): Clip | undefined {
  for (const c of clips) {
    if (time < c.offset - FRAME_EPS || time > clipEnd(c) + FRAME_EPS) continue;
    if (c.type === 'blank') return c;
    const track = tracks[c.track];
    if (track?.type === 'video' && (c.type === 'video' || c.type === 'image')) return c;
  }
  return undefined;
}

export const VideoPlayer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const [isDraggingOverlay, setIsDraggingOverlay] = useState(false);
  const [resizeMode, setResizeMode] = useState<string | null>(null);
  const dragStartRef = useRef<{ ox: number; oy: number; ow: number; oh: number; mx: number; my: number } | null>(null);

  const videoPoolRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const lastDrawnRef = useRef<ImageData | null>(null);

  const {
    clips, tracks, currentTime, isPlaying, duration,
    setCurrentTime, setIsPlaying, activeMediaId, mediaFiles,
    textOverlays, imageOverlays, transitions,
    selectedOverlayId,
    selectOverlay, clearSelection,
    updateTextOverlay, updateImageOverlay,
  } = useEditorStore();

  const hasTimelineClips = clips.length > 0;
  const hasOverlays = textOverlays.length > 0 || imageOverlays.length > 0;

  useEffect(() => { preloadOverlayImages(imageOverlays); }, [imageOverlays]);

  const getOrCreateVideo = useCallback((src: string): HTMLVideoElement => {
    const pool = videoPoolRef.current;
    let el = pool.get(src);
    if (el) return el;

    el = document.createElement('video');
    el.preload = 'auto';
    el.playsInline = true;
    el.muted = true;
    el.src = src;
    el.load();
    pool.set(src, el);
    return el;
  }, []);

  // Preload ALL clip video sources immediately
  useEffect(() => {
    for (const c of clips) {
      if (c.type === 'video' && c.sourcePath) getOrCreateVideo(c.sourcePath);
    }
  }, [clips, getOrCreateVideo]);

  // Keep the active video element playing/paused in sync
  useEffect(() => {
    const pool = videoPoolRef.current;
    const state = useEditorStore.getState();
    for (const c of state.clips) {
      if (c.type !== 'video' || !c.sourcePath) continue;
      const vid = pool.get(c.sourcePath);
      if (!vid) continue;

      const ct = state.currentTime;
      const cEnd = clipEnd(c);
      const isActive = ct >= c.offset - FRAME_EPS && ct <= cEnd + FRAME_EPS;

      if (isActive && isPlaying) {
        vid.playbackRate = c.speed;
        if (vid.paused) vid.play().catch(() => {});
      } else if (!isActive || !isPlaying) {
        if (!vid.paused) vid.pause();
      }
    }
  }, [isPlaying, currentTime, clips, getOrCreateVideo]);

  // Canvas render loop — the heart of gapless playback
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let running = true;

    const render = () => {
      if (!running) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      const h = rect.height;

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        lastDrawnRef.current = null;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const state = useEditorStore.getState();
      const ct = state.currentTime;
      const pool = videoPoolRef.current;

      // Pre-seek: for every video clip, sync the pool element to its correct source time.
      // This is critical — doing it in the render loop (not a React effect) guarantees
      // the seek happens BEFORE we try to draw, eliminating the 1-frame lag.
      for (const c of state.clips) {
        if (c.type !== 'video' || !c.sourcePath) continue;
        const cEnd = clipEnd(c);
        // Seek clips that are currently active OR about to become active (within 0.5s)
        const isNearby = ct >= c.offset - 0.5 && ct <= cEnd + 0.1;
        if (!isNearby) continue;

        const vid = pool.get(c.sourcePath);
        if (!vid) continue;

        const srcTime = c.start + Math.max(0, ct - c.offset) * c.speed;
        const clampedSrc = Math.min(srcTime, c.end);
        if (Math.abs(vid.currentTime - clampedSrc) > 0.1) {
          vid.currentTime = clampedSrc;
        }
        vid.playbackRate = c.speed;
      }

      let drewSomething = false;

      // --- Transitions ---
      let drewTransition = false;
      for (const tr of state.transitions) {
        const fromClip = state.clips.find((c) => c.id === tr.fromClipId);
        const toClip = state.clips.find((c) => c.id === tr.toClipId);
        if (!fromClip || !toClip) continue;

        const fromEndT = clipEnd(fromClip);
        const overlapStart = Math.max(fromEndT - tr.duration, toClip.offset);

        if (ct >= overlapStart - FRAME_EPS && ct <= fromEndT + FRAME_EPS) {
          const fromFrame = fromClip.type === 'video' ? pool.get(fromClip.sourcePath) : null;
          const toFrame = toClip.type === 'video' ? pool.get(toClip.sourcePath) : null;

          const fromReady = fromFrame && fromFrame.readyState >= 2;
          const toReady = toFrame && toFrame.readyState >= 2;

          if (fromReady || toReady) {
            ctx.clearRect(0, 0, w, h);
            drewTransition = renderTransition(
              ctx, tr, fromClip, toClip,
              fromReady ? fromFrame : null,
              toReady ? toFrame : null,
              w, h, ct,
            );
            drewSomething = drewTransition;
          }
          if (drewTransition) break;
        }
      }

      // --- Normal clip rendering ---
      if (!drewTransition) {
        const currentClip = findVisualClipAt(state.clips, state.tracks, ct);

        if (currentClip?.type === 'blank') {
          ctx.clearRect(0, 0, w, h);
          renderBlankClip(ctx, currentClip, w, h);
          drewSomething = true;
        } else if (currentClip?.type === 'image') {
          const img = new Image();
          img.src = currentClip.sourcePath;
          if (img.complete && img.naturalWidth > 0) {
            ctx.clearRect(0, 0, w, h);
            drawFit(ctx, img, w, h);
            drewSomething = true;
          }
        } else if (currentClip?.type === 'video') {
          const vid = pool.get(currentClip.sourcePath);
          // Draw if we have ANY decoded frame — readyState >= 1 means
          // metadata loaded, >= 2 means current frame available.
          // Even readyState 1 often has a decoded frame from a prior seek.
          if (vid && vid.readyState >= 2) {
            ctx.clearRect(0, 0, w, h);
            drawFit(ctx, vid, w, h);
            drewSomething = true;
          } else if (vid && vid.readyState >= 1 && vid.videoWidth > 0) {
            // Try drawing anyway — browser may have a stale decoded frame
            try {
              ctx.clearRect(0, 0, w, h);
              drawFit(ctx, vid, w, h);
              drewSomething = true;
            } catch {
              // Drawing failed, hold previous frame
            }
          }
          // If vid not ready at all, we do NOT clear — previous frame stays
        } else if (!state.clips.length && !hasOverlays) {
          // No clips at all, show library preview
          const activeMid = state.activeMediaId;
          const activeMf = activeMid ? state.mediaFiles.find((f) => f.id === activeMid) : null;
          if (activeMf) {
            if (activeMf.type === 'image') {
              const img = new Image();
              img.src = activeMf.path;
              if (img.complete && img.naturalWidth > 0) {
                ctx.clearRect(0, 0, w, h);
                drawFit(ctx, img, w, h);
                drewSomething = true;
              }
            } else if (activeMf.type === 'video') {
              const vid = pool.get(activeMf.path);
              if (vid && vid.readyState >= 2) {
                ctx.clearRect(0, 0, w, h);
                drawFit(ctx, vid, w, h);
                drewSomething = true;
              }
            }
          }

          if (!drewSomething) {
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);
            drewSomething = true;
          }
        }
        // CRITICAL: If we found a clip but couldn't draw it (video not ready),
        // we intentionally do NOT clear the canvas. The previous frame stays
        // visible, eliminating the black flash.
      }

      // --- Image overlays ---
      const sortedImages = [...state.imageOverlays]
        .filter((o) => ct >= o.startTime && ct <= o.endTime)
        .sort((a, b) => a.layer - b.layer);
      for (const io of sortedImages) {
        renderImageOverlay(ctx, io, w, h, ct);
      }

      // --- Text overlays ---
      const sortedTexts = [...state.textOverlays]
        .filter((o) => ct >= o.startTime && ct <= o.endTime)
        .sort((a, b) => a.layer - b.layer);
      for (const to of sortedTexts) {
        renderTextOverlay(ctx, to, w, h, ct);
      }

      // --- Selection bounding box ---
      if (state.selectedOverlayId) {
        const textOv = state.textOverlays.find((t) => t.id === state.selectedOverlayId);
        const imgOv = state.imageOverlays.find((i) => i.id === state.selectedOverlayId);
        const ov = textOv || imgOv;
        if (ov) {
          renderOverlayBoundingBox(ctx, ov.x, ov.y, ov.width, ov.height, ov.rotation, w, h);
          if (isDraggingOverlay || resizeMode) {
            renderSnapGuides(ctx, w, h, ov.x, ov.y);
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
    return () => { running = false; cancelAnimationFrame(animFrameRef.current); };
  }, [isDraggingOverlay, resizeMode, hasTimelineClips, hasOverlays]);

  // --- Mouse interaction ---
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    const state = useEditorStore.getState();
    const ct = state.currentTime;

    if (state.selectedOverlayId) {
      const textOv = state.textOverlays.find((t) => t.id === state.selectedOverlayId);
      const imgOv = state.imageOverlays.find((i) => i.id === state.selectedOverlayId);
      const ov = textOv || imgOv;
      if (ov) {
        const handleRadius = 12 / rect.width;
        const corners = [
          { name: 'tl', x: ov.x - ov.width / 2, y: ov.y - ov.height / 2 },
          { name: 'tr', x: ov.x + ov.width / 2, y: ov.y - ov.height / 2 },
          { name: 'bl', x: ov.x - ov.width / 2, y: ov.y + ov.height / 2 },
          { name: 'br', x: ov.x + ov.width / 2, y: ov.y + ov.height / 2 },
        ];
        for (const corner of corners) {
          if (Math.abs(mx - corner.x) < handleRadius && Math.abs(my - corner.y) < handleRadius) {
            setResizeMode(corner.name);
            dragStartRef.current = {
              ox: ov.x, oy: ov.y, ow: ov.width, oh: ov.height,
              mx: e.clientX, my: e.clientY,
            };
            const ovType = textOv ? 'text' : 'image';
            const onMove = (me: MouseEvent) => {
              if (!dragStartRef.current) return;
              const r = canvas.getBoundingClientRect();
              const dx = (me.clientX - dragStartRef.current.mx) / r.width;
              const dy = (me.clientY - dragStartRef.current.my) / r.height;
              let newW = dragStartRef.current.ow;
              let newH = dragStartRef.current.oh;
              const newX = dragStartRef.current.ox;
              const newY = dragStartRef.current.oy;
              if (corner.name.includes('r')) newW = Math.max(0.03, dragStartRef.current.ow + dx * 2);
              if (corner.name.includes('l')) newW = Math.max(0.03, dragStartRef.current.ow - dx * 2);
              if (corner.name.includes('b')) newH = Math.max(0.03, dragStartRef.current.oh + dy * 2);
              if (corner.name.includes('t')) newH = Math.max(0.03, dragStartRef.current.oh - dy * 2);
              if (ovType === 'text') updateTextOverlay(ov.id, { width: newW, height: newH, x: newX, y: newY });
              else updateImageOverlay(ov.id, { width: newW, height: newH, x: newX, y: newY });
            };
            const onUp = () => {
              setResizeMode(null);
              dragStartRef.current = null;
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            return;
          }
        }
      }
    }

    const allOverlays = [
      ...state.textOverlays.filter((o) => ct >= o.startTime && ct <= o.endTime).map((o) => ({ ...o, _type: 'text' as const })),
      ...state.imageOverlays.filter((o) => ct >= o.startTime && ct <= o.endTime).map((o) => ({ ...o, _type: 'image' as const })),
    ].sort((a, b) => b.layer - a.layer);

    for (const ov of allOverlays) {
      const hw = ov.width / 2;
      const hh = ov.height / 2;
      if (mx >= ov.x - hw && mx <= ov.x + hw && my >= ov.y - hh && my <= ov.y + hh) {
        selectOverlay(ov.id, ov._type);
        setIsDraggingOverlay(true);
        dragStartRef.current = { ox: ov.x, oy: ov.y, ow: ov.width, oh: ov.height, mx: e.clientX, my: e.clientY };
        const onMove = (me: MouseEvent) => {
          if (!dragStartRef.current || !canvas) return;
          const r = canvas.getBoundingClientRect();
          const dx = (me.clientX - dragStartRef.current.mx) / r.width;
          const dy = (me.clientY - dragStartRef.current.my) / r.height;
          let newX = dragStartRef.current.ox + dx;
          let newY = dragStartRef.current.oy + dy;
          if (Math.abs(newX - 0.5) < 0.02) newX = 0.5;
          if (Math.abs(newY - 0.5) < 0.02) newY = 0.5;
          newX = Math.max(0, Math.min(1, newX));
          newY = Math.max(0, Math.min(1, newY));
          if (ov._type === 'text') updateTextOverlay(ov.id, { x: newX, y: newY });
          else updateImageOverlay(ov.id, { x: newX, y: newY });
        };
        const onUp = () => {
          setIsDraggingOverlay(false);
          dragStartRef.current = null;
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
      }
    }
    clearSelection();
  }, [selectOverlay, clearSelection, updateTextOverlay, updateImageOverlay]);

  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const files = e.dataTransfer.files;
    if (!files.length || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dropX = (e.clientX - rect.left) / rect.width;
    const dropY = (e.clientY - rect.top) / rect.height;
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        loadImage(url).then(() => {
          const id = useEditorStore.getState().addImageOverlay(url, file.name, file);
          useEditorStore.getState().updateImageOverlay(id, {
            x: Math.max(0.1, Math.min(0.9, dropX)),
            y: Math.max(0.1, Math.min(0.9, dropY)),
          });
        }).catch(() => {});
      }
    }
  }, []);

  const activeClip = clips.find((c) =>
    currentTime >= c.offset - FRAME_EPS && currentTime <= clipEnd(c) + FRAME_EPS,
  );
  const activeMedia = activeMediaId ? mediaFiles.find((f) => f.id === activeMediaId) : null;
  const previewSource = hasTimelineClips ? (activeClip?.sourcePath || null) : (activeMedia?.path || null);
  const noClipMessage = hasTimelineClips && !activeClip && !hasOverlays ? 'No clip at current time' : null;

  const togglePlay = useCallback(() => {
    if (duration === 0 && clips.length === 0 && !activeMedia) return;
    setIsPlaying(!isPlaying);
  }, [isPlaying, duration, clips.length, activeMedia, setIsPlaying]);

  const skipBack = useCallback(() => setCurrentTime(Math.max(0, currentTime - 5)), [currentTime, setCurrentTime]);
  const skipForward = useCallback(() => setCurrentTime(currentTime + 5), [currentTime, setCurrentTime]);
  const goToStart = useCallback(() => setCurrentTime(0), [setCurrentTime]);
  const goToEnd = useCallback(() => { if (duration > 0) setCurrentTime(duration); }, [duration, setCurrentTime]);

  const cursorStyle = resizeMode
    ? (resizeMode === 'tl' || resizeMode === 'br' ? 'nwse-resize' : 'nesw-resize')
    : isDraggingOverlay ? 'grabbing' : 'default';

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Preview</h2>
        <span className="text-xs text-gray-500 font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center bg-black relative overflow-hidden"
        onDrop={handleCanvasDrop}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          onMouseDown={handleCanvasMouseDown}
          style={{ cursor: cursorStyle }}
        />

        {!previewSource && !hasOverlays && !noClipMessage && (
          <div className="text-center text-gray-600 z-10 pointer-events-none">
            <svg className="w-16 h-16 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">Import media and add to timeline</p>
            <p className="text-xs text-gray-700 mt-1">Drop images here to add overlays</p>
          </div>
        )}

        {noClipMessage && (
          <div className="text-center text-gray-600 z-10 pointer-events-none">
            <p className="text-xs">{noClipMessage}</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-800">
        <div className="flex items-center justify-center gap-2">
          <PlayerButton onClick={goToStart} title="Go to start">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
          </PlayerButton>
          <PlayerButton onClick={skipBack} title="Back 5s">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" /></svg>
          </PlayerButton>
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition-colors"
          >
            {isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
            ) : (
              <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <PlayerButton onClick={skipForward} title="Forward 5s">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" /></svg>
          </PlayerButton>
          <PlayerButton onClick={goToEnd} title="Go to end">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          </PlayerButton>
        </div>
      </div>
    </div>
  );
};

function drawFit(ctx: CanvasRenderingContext2D, source: HTMLVideoElement | HTMLImageElement, cw: number, ch: number) {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!sw || !sh) return;
  const scale = Math.min(cw / sw, ch / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(source, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

const PlayerButton: React.FC<{
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
  >
    {children}
  </button>
);
