import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { Clip, Track, ExportSettings, TextOverlay, ImageOverlay, Transition } from './types';
import { computeEffectiveVolume } from './helpers';
import { muxVideoWithAAC, convertWebMToMP4 } from './ffmpegService';
import {
  renderTextOverlay, renderImageOverlay, renderBlankClip,
  renderTransition, loadImage as loadOverlayImage, preloadOverlayImages,
} from './overlayRenderer';
import { acquireExportLock, releaseExportLock, setExportProgress } from './exportWakeLock';

export interface ExportStatus {
  phase: string;
  detail: string;
  step: number;
  totalSteps: number;
  currentFrame?: number;
  totalFrames?: number;
  fps?: number;
  elapsedMs: number;
  estimatedTotalMs?: number;
}

export interface ExportCallbacks {
  onProgress: (percent: number) => void;
  onStatus: (status: ExportStatus) => void;
  onComplete: (blob: Blob, filename: string) => void;
  onError: (error: string) => void;
}

export interface ExportData {
  clips: Clip[];
  tracks: Track[];
  textOverlays: TextOverlay[];
  imageOverlays: ImageOverlay[];
  transitions: Transition[];
  settings: ExportSettings;
}

const BITRATE_MAP = { high: 12_000_000, medium: 6_000_000, low: 3_000_000 };
const AUDIO_BITRATE_MAP = { high: 256_000, medium: 192_000, low: 128_000 };
const SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;

export async function browserExportVideo(
  data: ExportData,
  callbacks: ExportCallbacks,
): Promise<void> {
  const { clips, settings, textOverlays, imageOverlays } = data;

  const hasContent = clips.length > 0 || textOverlays.length > 0 || imageOverlays.length > 0;
  if (!hasContent) {
    callbacks.onError('No clips to export');
    return;
  }

  // Acquire wake lock to prevent tab suspension / OS sleep
  const lockState = await acquireExportLock();
  console.log('[Export] Wake lock acquired:', lockState);

  const wrappedCallbacks: ExportCallbacks = {
    ...callbacks,
    onProgress: (percent) => {
      callbacks.onProgress(percent);
    },
    onStatus: (status) => {
      callbacks.onStatus(status);
      setExportProgress(Math.round(status.elapsedMs > 0 ? (status.currentFrame ?? status.step) / (status.totalFrames ?? status.totalSteps) * 100 : 0), status.phase);
    },
    onComplete: (blob, filename) => {
      setExportProgress(100, 'Complete');
      releaseExportLock();
      callbacks.onComplete(blob, filename);
    },
    onError: (error) => {
      releaseExportLock();
      callbacks.onError(error);
    },
  };

  preloadOverlayImages(imageOverlays);
  for (const io of imageOverlays) {
    try { await loadOverlayImage(io.src); } catch {}
  }

  const wantMP4 = settings.format !== 'webm';
  const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
  const hasAudioEncoder = typeof AudioEncoder !== 'undefined';
  const hasWebCodecs = hasVideoEncoder && hasAudioEncoder;

  console.log('[Export] Browser capabilities:', {
    VideoEncoder: hasVideoEncoder, AudioEncoder: hasAudioEncoder, WebCodecs: hasWebCodecs,
    format: settings.format, userAgent: navigator.userAgent,
  });

  try {
    if (hasWebCodecs && wantMP4) {
      await exportMP4WebCodecs(data, wrappedCallbacks);
    } else if (wantMP4) {
      await exportMP4ViaWebM(data, wrappedCallbacks);
    } else {
      await exportWebM(data, wrappedCallbacks);
    }
  } catch (err) {
    releaseExportLock();
    throw err;
  }
}

function computeTotalDuration(data: ExportData): number {
  let maxEnd = 0;
  for (const c of data.clips) maxEnd = Math.max(maxEnd, c.offset + (c.end - c.start) / c.speed);
  for (const t of data.textOverlays) maxEnd = Math.max(maxEnd, t.endTime);
  for (const i of data.imageOverlays) maxEnd = Math.max(maxEnd, i.endTime);
  return maxEnd;
}

function renderFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  data: ExportData,
  videoEls: Map<string, HTMLVideoElement>,
  imageEls: Map<string, HTMLImageElement>,
) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  const { clips, tracks, transitions, textOverlays, imageOverlays } = data;

  let drewTransition = false;
  for (const tr of transitions) {
    const from = clips.find((c) => c.id === tr.fromClipId);
    const to = clips.find((c) => c.id === tr.toClipId);
    if (!from || !to) continue;

    const fromEnd = from.offset + (from.end - from.start) / from.speed;
    const overlapStart = Math.max(fromEnd - tr.duration, to.offset);

    if (time >= overlapStart && time <= fromEnd) {
      const fromEl = from.type === 'image' ? imageEls.get(from.sourcePath) : videoEls.get(from.sourcePath);
      const toEl = to.type === 'image' ? imageEls.get(to.sourcePath) : videoEls.get(to.sourcePath);
      drewTransition = renderTransition(
        ctx, tr, from, to,
        (fromEl as HTMLVideoElement | HTMLImageElement) || null,
        (toEl as HTMLVideoElement | HTMLImageElement) || null,
        w, h, time,
      );
      if (drewTransition) break;
    }
  }

  if (!drewTransition) {
    const vis = findActiveVisualClip(clips, tracks, time);
    if (vis) {
      if (vis.type === 'blank') {
        renderBlankClip(ctx, vis, w, h);
      } else if (vis.type === 'image') {
        const img = imageEls.get(vis.sourcePath);
        if (img) drawFit(ctx, img, w, h);
      } else if (vis.type === 'video') {
        const vid = videoEls.get(vis.sourcePath);
        if (vid) drawFit(ctx, vid, w, h);
      }
    }
  }

  const sortedImages = [...imageOverlays]
    .filter((o) => time >= o.startTime && time <= o.endTime)
    .sort((a, b) => a.layer - b.layer);
  for (const io of sortedImages) {
    renderImageOverlay(ctx, io, w, h, time);
  }

  const sortedTexts = [...textOverlays]
    .filter((o) => time >= o.startTime && time <= o.endTime)
    .sort((a, b) => a.layer - b.layer);
  for (const to of sortedTexts) {
    renderTextOverlay(ctx, to, w, h, time);
  }
}

// PATH A: WebCodecs H.264 + ffmpeg.wasm AAC → MP4
async function exportMP4WebCodecs(
  data: ExportData,
  { onProgress, onStatus, onComplete, onError }: ExportCallbacks,
) {
  const { clips, tracks, settings } = data;
  const [w, h] = settings.resolution.split('x').map(Number);
  const fps = settings.fps;
  const videoBitrate = BITRATE_MAP[settings.quality];
  const audioBitrate = AUDIO_BITRATE_MAP[settings.quality];

  const sortedClips = [...clips].sort((a, b) => a.offset - b.offset);
  const totalDuration = computeTotalDuration(data);
  const TOTAL_STEPS = 5;
  const exportStart = performance.now();

  if (totalDuration <= 0) { onError('Timeline is empty'); return; }

  const elapsed = () => performance.now() - exportStart;

  // ── Step 1: Load media assets ──
  onProgress(0);
  const mediaCount = sortedClips.filter((c) => c.type !== 'blank').length;
  onStatus({ phase: 'Loading media', detail: `Preparing ${mediaCount} clip(s)…`, step: 1, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });

  const videoEls = new Map<string, HTMLVideoElement>();
  const imageEls = new Map<string, HTMLImageElement>();
  let loadedCount = 0;

  for (const clip of sortedClips) {
    if (clip.type === 'blank') continue;
    if (clip.type === 'image' && !imageEls.has(clip.sourcePath)) {
      const img = new Image();
      img.src = clip.sourcePath;
      await loadImg(img);
      imageEls.set(clip.sourcePath, img);
    } else if ((clip.type === 'video' || clip.type === 'audio') && !videoEls.has(clip.sourcePath)) {
      const el = document.createElement('video');
      el.preload = 'auto';
      el.muted = true;
      el.src = clip.sourcePath;
      await loadMediaElement(el);
      videoEls.set(clip.sourcePath, el);
    }
    loadedCount++;
    onStatus({ phase: 'Loading media', detail: `Loaded ${loadedCount} / ${mediaCount} assets`, step: 1, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
    onProgress(Math.round((loadedCount / mediaCount) * 5));
  }

  // ── Step 2: Render audio ──
  onStatus({ phase: 'Processing audio', detail: 'Decoding audio tracks…', step: 2, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
  onProgress(6);

  let renderedAudio: AudioBuffer | null = null;
  try {
    renderedAudio = await renderAudioOffline(sortedClips, tracks, totalDuration);
    const rms = computeRMS(renderedAudio);
    if (rms < 0.0001) { renderedAudio = null; }
    onStatus({ phase: 'Processing audio', detail: renderedAudio ? 'Audio decoded successfully' : 'No audible audio detected', step: 2, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
  } catch {
    onStatus({ phase: 'Processing audio', detail: 'Offline decode failed, trying real-time capture…', step: 2, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
  }

  if (!renderedAudio) {
    try {
      renderedAudio = await captureAudioRealTime(sortedClips, tracks, totalDuration, (p) => {
        onProgress(6 + Math.round(p * 4));
        onStatus({ phase: 'Processing audio', detail: `Real-time capture… ${Math.round(p * 100)}%`, step: 2, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
      });
      const rms = computeRMS(renderedAudio);
      if (rms < 0.0001) { renderedAudio = null; }
    } catch {}
  }
  onProgress(10);

  // ── Step 3: Encode video frames ──
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h },
    fastStart: 'in-memory',
  });

  const videoCodec = 'avc1.640028';
  const videoSupport = await VideoEncoder.isConfigSupported({
    codec: videoCodec, width: w, height: h, bitrate: videoBitrate, framerate: fps,
  });
  const finalCodec = videoSupport.supported ? videoCodec : 'avc1.42001E';

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error('[Export] VideoEncoder error:', e),
  });

  videoEncoder.configure({
    codec: finalCodec, width: w, height: h,
    bitrate: videoBitrate, framerate: fps,
    latencyMode: 'realtime', avc: { format: 'avc' },
  });

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const totalFrames = Math.ceil(totalDuration * fps);
  const keyFrameInterval = fps * 2;
  const frameDuration = 1 / fps;
  const encodeStart = performance.now();

  onStatus({
    phase: 'Encoding video', detail: `0 / ${totalFrames} frames (${w}×${h} @ ${fps}fps)`,
    step: 3, totalSteps: TOTAL_STEPS, currentFrame: 0, totalFrames, fps,
    elapsedMs: elapsed(),
  });

  let prevClipId = '';

  for (let fi = 0; fi < totalFrames; fi++) {
    const time = fi / fps;

    const vis = findActiveVisualClip(sortedClips, tracks, time);
    if (vis && vis.type === 'video') {
      const vid = videoEls.get(vis.sourcePath);
      if (vid) {
        const targetTime = vis.start + Math.max(0, time - vis.offset) * vis.speed;
        const drift = Math.abs(vid.currentTime - targetTime);

        if (vis.id !== prevClipId || drift > 1.0) {
          await seekVideoFull(vid, targetTime);
        } else if (drift > frameDuration * 0.4) {
          seekVideoFast(vid, targetTime);
        }
      }
      prevClipId = vis.id;
    } else {
      prevClipId = vis?.id || '';
    }

    renderFrame(ctx, w, h, time, data, videoEls, imageEls);

    const frame = new VideoFrame(canvas, { timestamp: Math.round(time * 1_000_000) });
    videoEncoder.encode(frame, { keyFrame: fi % keyFrameInterval === 0 });
    frame.close();

    if (videoEncoder.encodeQueueSize > 15) {
      await waitForEncoderDrain(videoEncoder, 5);
    }

    if (fi % 30 === 0) {
      const pct = 10 + Math.round((fi / totalFrames) * 60);
      onProgress(pct);

      const encodeElapsed = performance.now() - encodeStart;
      const framesPerMs = (fi + 1) / encodeElapsed;
      const remainingFrames = totalFrames - fi - 1;
      const estimatedTotalMs = elapsed() + (remainingFrames / framesPerMs);
      const encodeFps = ((fi + 1) / (encodeElapsed / 1000)).toFixed(1);

      onStatus({
        phase: 'Encoding video',
        detail: `Frame ${fi + 1} / ${totalFrames} · ${encodeFps} fps`,
        step: 3, totalSteps: TOTAL_STEPS,
        currentFrame: fi + 1, totalFrames, fps: parseFloat(encodeFps),
        elapsedMs: elapsed(), estimatedTotalMs,
      });
      await yieldToUI();
    }
  }

  await videoEncoder.flush();
  videoEncoder.close();

  // ── Step 4: Finalize container ──
  onStatus({ phase: 'Finalizing video', detail: 'Building MP4 container…', step: 4, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
  onProgress(72);

  muxer.finalize();
  const videoOnlyBuf = (muxer.target as ArrayBufferTarget).buffer;
  const videoOnlyBlob = new Blob([videoOnlyBuf], { type: 'video/mp4' });
  const videoSizeMB = (videoOnlyBuf.byteLength / 1024 / 1024).toFixed(1);

  onStatus({ phase: 'Finalizing video', detail: `Video track ready — ${videoSizeMB} MB`, step: 4, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
  onProgress(75);

  let finalBlob = videoOnlyBlob;

  // ── Step 5: Mux audio ──
  if (renderedAudio) {
    onStatus({ phase: 'Adding audio', detail: 'Encoding AAC audio via FFmpeg…', step: 5, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
    const withAudio = await muxVideoWithAAC(
      videoOnlyBlob, renderedAudio, audioBitrate,
      (r) => {
        onProgress(75 + Math.round(r * 20));
        onStatus({ phase: 'Adding audio', detail: `Muxing audio… ${Math.round(r * 100)}%`, step: 5, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
      },
    );
    if (withAudio) {
      finalBlob = withAudio;
    } else {
      onStatus({ phase: 'Adding audio', detail: 'Audio mux failed — exporting video only', step: 5, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
    }
  } else {
    onStatus({ phase: 'Adding audio', detail: 'No audio to include', step: 5, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
  }

  videoEls.forEach((el) => { el.pause(); el.removeAttribute('src'); el.load(); });

  const finalSizeMB = (finalBlob.size / 1024 / 1024).toFixed(1);
  const totalSec = (elapsed() / 1000).toFixed(1);
  onStatus({ phase: 'Complete', detail: `${finalSizeMB} MB in ${totalSec}s`, step: TOTAL_STEPS, totalSteps: TOTAL_STEPS, elapsedMs: elapsed() });
  onProgress(100);

  const filename = `export_${Date.now()}.mp4`;
  onComplete(finalBlob, filename);
}

// PATH B: MediaRecorder WebM → ffmpeg.wasm MP4
async function exportMP4ViaWebM(
  data: ExportData,
  { onProgress, onStatus, onComplete, onError }: ExportCallbacks,
) {
  const audioBitrate = AUDIO_BITRATE_MAP[data.settings.quality];
  const totalDuration = computeTotalDuration(data);
  const exportStart = performance.now();
  const elapsed = () => performance.now() - exportStart;

  onStatus({ phase: 'Recording timeline', detail: 'Real-time capture starting…', step: 1, totalSteps: 3, elapsedMs: elapsed() });

  const webmBlob = await captureWebM(data, (p) => {
    const sec = (p * totalDuration).toFixed(1);
    onProgress(Math.round(p * 50));
    onStatus({ phase: 'Recording timeline', detail: `Captured ${sec}s / ${totalDuration.toFixed(1)}s`, step: 1, totalSteps: 3, elapsedMs: elapsed() });
  });
  if (!webmBlob) { onError('WebM capture failed'); return; }

  const webmMB = (webmBlob.size / 1024 / 1024).toFixed(1);
  onStatus({ phase: 'Converting to MP4', detail: `WebM captured (${webmMB} MB), converting…`, step: 2, totalSteps: 3, elapsedMs: elapsed() });
  onProgress(55);

  const mp4Blob = await convertWebMToMP4(
    webmBlob, audioBitrate,
    (r) => {
      onProgress(55 + Math.round(r * 40));
      onStatus({ phase: 'Converting to MP4', detail: `FFmpeg converting… ${Math.round(r * 100)}%`, step: 2, totalSteps: 3, elapsedMs: elapsed() });
    },
  );

  const finalBlob = mp4Blob || webmBlob;
  const ext = mp4Blob ? 'mp4' : 'webm';
  const sizeMB = (finalBlob.size / 1024 / 1024).toFixed(1);
  const totalSec = (elapsed() / 1000).toFixed(1);

  onStatus({ phase: 'Complete', detail: `${sizeMB} MB in ${totalSec}s`, step: 3, totalSteps: 3, elapsedMs: elapsed() });
  onProgress(100);
  onComplete(finalBlob, `export_${Date.now()}.${ext}`);
}

// PATH C: Direct WebM
async function exportWebM(
  data: ExportData,
  { onProgress, onStatus, onComplete, onError }: ExportCallbacks,
) {
  const totalDuration = computeTotalDuration(data);
  const exportStart = performance.now();
  const elapsed = () => performance.now() - exportStart;

  onStatus({ phase: 'Recording WebM', detail: 'Real-time capture starting…', step: 1, totalSteps: 2, elapsedMs: elapsed() });

  const webmBlob = await captureWebM(data, (p) => {
    const sec = (p * totalDuration).toFixed(1);
    onProgress(Math.round(p * 100));
    onStatus({ phase: 'Recording WebM', detail: `Captured ${sec}s / ${totalDuration.toFixed(1)}s`, step: 1, totalSteps: 2, elapsedMs: elapsed() });
  });
  if (!webmBlob) { onError('Export failed'); return; }

  const sizeMB = (webmBlob.size / 1024 / 1024).toFixed(1);
  const totalSec = (elapsed() / 1000).toFixed(1);
  onStatus({ phase: 'Complete', detail: `${sizeMB} MB in ${totalSec}s`, step: 2, totalSteps: 2, elapsedMs: elapsed() });
  onProgress(100);
  onComplete(webmBlob, `export_${Date.now()}.webm`);
}

// Shared: Capture timeline to WebM
async function captureWebM(
  data: ExportData,
  onProgress: (fraction: number) => void,
): Promise<Blob | null> {
  const { clips, tracks, settings } = data;
  const [w, h] = settings.resolution.split('x').map(Number);
  const fps = settings.fps;
  const videoBitrate = BITRATE_MAP[settings.quality];
  const sortedClips = [...clips].sort((a, b) => a.offset - b.offset);
  const totalDuration = computeTotalDuration(data);

  if (totalDuration <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  let audioCtx: AudioContext;
  let audioDestination: MediaStreamAudioDestinationNode;
  try {
    audioCtx = new AudioContext();
    await audioCtx.resume();
    audioDestination = audioCtx.createMediaStreamDestination();
  } catch (err) {
    console.error('[WebM] AudioContext creation failed:', err);
    return null;
  }

  interface ClipState {
    clip: Clip;
    element: HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
    gainNode: GainNode | null;
  }

  const states: ClipState[] = [];

  const videoEls = new Map<string, HTMLVideoElement>();
  const imageEls = new Map<string, HTMLImageElement>();

  for (const clip of sortedClips) {
    if (clip.type === 'blank') {
      states.push({ clip, element: new Image(), gainNode: null });
      continue;
    }

    if (clip.type === 'image') {
      const img = new Image();
      img.src = clip.sourcePath;
      await loadImg(img);
      imageEls.set(clip.sourcePath, img);
      states.push({ clip, element: img, gainNode: null });
      continue;
    }

    const el = clip.type === 'audio' ? document.createElement('audio') : document.createElement('video');
    el.preload = 'auto';
    el.src = clip.sourcePath;
    await loadMediaElement(el);

    if (el instanceof HTMLVideoElement) videoEls.set(clip.sourcePath, el);

    let gainNode: GainNode | null = null;
    try {
      const srcNode = audioCtx.createMediaElementSource(el);
      gainNode = audioCtx.createGain();
      gainNode.gain.value = 0;
      srcNode.connect(gainNode);
      gainNode.connect(audioDestination);
    } catch {}

    states.push({ clip, element: el, gainNode });
  }

  let canvasStream: MediaStream;
  try {
    canvasStream = canvas.captureStream(fps);
  } catch {
    audioCtx.close().catch(() => {});
    return null;
  }

  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);

  const mimeTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mimeType) { audioCtx.close().catch(() => {}); return null; }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: videoBitrate });
  } catch {
    audioCtx.close().catch(() => {});
    return null;
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise<Blob | null>((resolve) => {
    recorder.onstop = () => {
      for (const s of states) {
        if (s.element instanceof HTMLMediaElement) {
          s.element.pause();
          s.element.removeAttribute('src');
          s.element.load();
        }
      }
      audioCtx.close().catch(() => {});

      if (chunks.length === 0) { resolve(null); return; }
      resolve(new Blob(chunks, { type: mimeType }));
    };

    recorder.onerror = () => resolve(null);
    recorder.start(100);

    const startWall = performance.now();

    function render() {
      const elapsed = (performance.now() - startWall) / 1000;

      if (elapsed >= totalDuration) {
        onProgress(1);
        setTimeout(() => recorder.stop(), 300);
        return;
      }

      onProgress(Math.min(0.99, elapsed / totalDuration));

      renderFrame(ctx, w, h, elapsed, data, videoEls, imageEls);

      for (const { clip, element, gainNode } of states) {
        if (clip.type === 'blank' || clip.type === 'image') continue;

        const clipDur = (clip.end - clip.start) / clip.speed;
        const clipEnd = clip.offset + clipDur;
        const isActive = elapsed >= clip.offset && elapsed < clipEnd;

        if (!isActive) {
          if (element instanceof HTMLMediaElement && !element.paused) element.pause();
          if (gainNode) gainNode.gain.value = 0;
          continue;
        }

        const track = tracks[clip.track];
        const vol = computeEffectiveVolume(clip, elapsed, track?.muted ?? false);
        if (gainNode) gainNode.gain.value = Math.min(1, Math.max(0, vol));

        if (element instanceof HTMLMediaElement) {
          const srcTime = clip.start + (elapsed - clip.offset) * clip.speed;
          element.playbackRate = clip.speed;
          if (element.paused) {
            element.currentTime = srcTime;
            element.play().catch(() => {});
          } else if (Math.abs(element.currentTime - srcTime) > 0.3) {
            element.currentTime = srcTime;
          }
        }
      }

      requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
  });
}

// Offline audio rendering
async function renderAudioOffline(clips: Clip[], tracks: Track[], duration: number): Promise<AudioBuffer> {
  const totalSamples = Math.ceil(duration * SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(AUDIO_CHANNELS, totalSamples, SAMPLE_RATE);
  const decodeCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await decodeCtx.resume();

  const audioClips = clips.filter((c) => c.type !== 'image' && c.type !== 'blank');
  let decodedCount = 0;

  for (const clip of audioClips) {
    const track = tracks[clip.track];
    if (track?.muted) continue;

    let audioBuffer: AudioBuffer;
    try {
      const resp = await fetch(clip.sourcePath);
      const arrBuf = await resp.arrayBuffer();
      audioBuffer = await decodeCtx.decodeAudioData(arrBuf);
    } catch { continue; }

    decodedCount++;

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = clip.speed;

    const gainNode = offlineCtx.createGain();
    const clipDuration = (clip.end - clip.start) / clip.speed;
    const startTime = clip.offset;
    const endTime = startTime + clipDuration;
    const baseVol = clip.audioVolume;

    gainNode.gain.setValueAtTime(clip.fadeIn > 0 ? 0 : baseVol, startTime);
    if (clip.fadeIn > 0) gainNode.gain.linearRampToValueAtTime(baseVol, startTime + clip.fadeIn);
    if (clip.fadeOut > 0) {
      const fadeOutStart = endTime - clip.fadeOut;
      if (clip.fadeIn <= 0 || fadeOutStart > startTime + clip.fadeIn) {
        gainNode.gain.setValueAtTime(baseVol, fadeOutStart);
      }
      gainNode.gain.linearRampToValueAtTime(0, endTime);
    }

    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    source.start(startTime, clip.start, clip.end - clip.start);
  }

  await decodeCtx.close();
  if (decodedCount === 0) throw new Error('No audio decoded');

  return await offlineCtx.startRendering();
}

// Real-time audio capture fallback
async function captureAudioRealTime(
  clips: Clip[], tracks: Track[], duration: number,
  onProgress?: (fraction: number) => void,
): Promise<AudioBuffer> {
  const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await audioCtx.resume();
  const dest = audioCtx.createMediaStreamDestination();

  interface CaptureState { clip: Clip; element: HTMLVideoElement | HTMLAudioElement; gainNode: GainNode; }
  const states: CaptureState[] = [];

  for (const clip of clips) {
    if (clip.type === 'image' || clip.type === 'blank') continue;
    const el = clip.type === 'audio' ? document.createElement('audio') : document.createElement('video');
    el.preload = 'auto';
    el.src = clip.sourcePath;
    await loadMediaElement(el);

    try {
      const src = audioCtx.createMediaElementSource(el);
      const gain = audioCtx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(dest);
      states.push({ clip, element: el, gainNode: gain });
    } catch { continue; }
  }

  if (states.length === 0) { await audioCtx.close(); throw new Error('No audio elements'); }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const recorder = new MediaRecorder(dest.stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise<AudioBuffer>((resolve, reject) => {
    recorder.onstop = async () => {
      states.forEach(({ element }) => { element.pause(); element.removeAttribute('src'); element.load(); });
      if (chunks.length === 0) { await audioCtx.close(); reject(new Error('No data')); return; }
      try {
        const blob = new Blob(chunks, { type: mimeType });
        const decoded = await audioCtx.decodeAudioData(await blob.arrayBuffer());
        await audioCtx.close();
        resolve(decoded);
      } catch (err) { await audioCtx.close(); reject(err); }
    };
    recorder.onerror = () => reject(new Error('MediaRecorder error'));
    recorder.start(100);
    const startWall = performance.now();

    function tick() {
      const elapsed = (performance.now() - startWall) / 1000;
      if (elapsed >= duration + 0.1) {
        states.forEach(({ element }) => element.pause());
        setTimeout(() => recorder.stop(), 200);
        return;
      }
      onProgress?.(Math.min(1, elapsed / duration));

      for (const { clip, element, gainNode } of states) {
        const clipDur = (clip.end - clip.start) / clip.speed;
        const isActive = elapsed >= clip.offset && elapsed < clip.offset + clipDur;
        if (!isActive) {
          if (!element.paused) element.pause();
          gainNode.gain.value = 0;
          continue;
        }
        const track = tracks[clip.track];
        gainNode.gain.value = Math.min(1, Math.max(0, computeEffectiveVolume(clip, elapsed, track?.muted ?? false)));
        const srcTime = clip.start + (elapsed - clip.offset) * clip.speed;
        element.playbackRate = clip.speed;
        if (element.paused) { element.currentTime = srcTime; element.play().catch(() => {}); }
        else if (Math.abs(element.currentTime - srcTime) > 0.5) { element.currentTime = srcTime; }
      }
      requestAnimationFrame(tick);
    }
    tick();
  });
}

// Helpers

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function computeRMS(buffer: AudioBuffer): number {
  let sum = 0, total = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    const n = Math.min(data.length, 48000 * 5);
    for (let i = 0; i < n; i++) { sum += data[i] * data[i]; total++; }
  }
  return total > 0 ? Math.sqrt(sum / total) : 0;
}

const FRAME_EPS = 0.01;

function findActiveVisualClip(clips: Clip[], tracks: Track[], time: number): Clip | undefined {
  return clips.find((c) => {
    const clipEnd = c.offset + (c.end - c.start) / c.speed;
    if (time < c.offset - FRAME_EPS || time >= clipEnd + FRAME_EPS) return false;
    if (c.type === 'blank') return true;
    const track = tracks[c.track];
    return track?.type === 'video' && (c.type === 'video' || c.type === 'image');
  });
}

function drawFit(ctx: CanvasRenderingContext2D, source: HTMLVideoElement | HTMLImageElement, cw: number, ch: number) {
  const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (sw === 0 || sh === 0) return;
  const scale = Math.min(cw / sw, ch / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(source, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

function seekVideoFull(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.02) { resolve(); return; }
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); clearTimeout(t); resolve(); };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
    const t = setTimeout(resolve, 80);
  });
}

function seekVideoFast(video: HTMLVideoElement, time: number) {
  video.currentTime = time;
}

function waitForEncoderDrain(encoder: VideoEncoder, target: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (encoder.encodeQueueSize <= target) resolve();
      else setTimeout(check, 1);
    };
    check();
  });
}

function loadImg(img: HTMLImageElement): Promise<void> {
  return new Promise((resolve) => {
    if (img.complete && img.naturalWidth > 0) { resolve(); return; }
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

function loadMediaElement(el: HTMLMediaElement): Promise<void> {
  return new Promise((resolve) => {
    if (el.readyState >= 3) { resolve(); return; }
    el.oncanplaythrough = () => resolve();
    el.onerror = () => resolve();
    el.load();
  });
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
