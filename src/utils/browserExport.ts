import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { Clip, Track, ExportSettings } from './types';
import { computeEffectiveVolume } from './helpers';
import { muxVideoWithAAC, convertWebMToMP4 } from './ffmpegService';

export interface ExportCallbacks {
  onProgress: (percent: number) => void;
  onComplete: (blob: Blob, filename: string) => void;
  onError: (error: string) => void;
}

const BITRATE_MAP = { high: 12_000_000, medium: 6_000_000, low: 3_000_000 };
const AUDIO_BITRATE_MAP = { high: 256_000, medium: 192_000, low: 128_000 };
const SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export async function browserExportVideo(
  clips: Clip[],
  tracks: Track[],
  settings: ExportSettings,
  callbacks: ExportCallbacks,
): Promise<void> {
  if (clips.length === 0) {
    callbacks.onError('No clips to export');
    return;
  }

  const wantMP4 = settings.format !== 'webm';
  const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
  const hasAudioEncoder = typeof AudioEncoder !== 'undefined';
  const hasWebCodecs = hasVideoEncoder && hasAudioEncoder;

  console.log('[Export] Browser capabilities:', {
    VideoEncoder: hasVideoEncoder,
    AudioEncoder: hasAudioEncoder,
    WebCodecs: hasWebCodecs,
    format: settings.format,
    userAgent: navigator.userAgent,
  });

  if (hasWebCodecs && wantMP4) {
    await exportMP4WebCodecs(clips, tracks, settings, callbacks);
  } else if (wantMP4) {
    await exportMP4ViaWebM(clips, tracks, settings, callbacks);
  } else {
    await exportWebM(clips, tracks, settings, callbacks);
  }
}

// ---------------------------------------------------------------------------
// PATH A: WebCodecs H.264 video + ffmpeg.wasm AAC audio → MP4
// Used when browser has WebCodecs (Chrome, Edge, etc.)
// ---------------------------------------------------------------------------
async function exportMP4WebCodecs(
  clips: Clip[],
  tracks: Track[],
  settings: ExportSettings,
  { onProgress, onComplete, onError }: ExportCallbacks,
) {
  const [w, h] = settings.resolution.split('x').map(Number);
  const fps = settings.fps;
  const videoBitrate = BITRATE_MAP[settings.quality];
  const audioBitrate = AUDIO_BITRATE_MAP[settings.quality];

  const sortedClips = [...clips].sort((a, b) => a.offset - b.offset);
  const totalDuration = Math.max(
    ...sortedClips.map((c) => c.offset + (c.end - c.start) / c.speed),
  );

  if (totalDuration <= 0) { onError('Timeline is empty'); return; }

  console.log('[Export] MP4 via WebCodecs + ffmpeg.wasm', {
    resolution: `${w}x${h}`, fps,
    duration: totalDuration.toFixed(2) + 's',
    clips: sortedClips.length,
  });

  onProgress(0);

  // ---- Load source elements ----
  const videoEls = new Map<string, HTMLVideoElement>();
  const imageEls = new Map<string, HTMLImageElement>();

  for (const clip of sortedClips) {
    if (clip.type === 'image' && !imageEls.has(clip.sourcePath)) {
      const img = new Image();
      img.src = clip.sourcePath;
      await loadImage(img);
      imageEls.set(clip.sourcePath, img);
    } else if (
      (clip.type === 'video' || clip.type === 'audio') &&
      !videoEls.has(clip.sourcePath)
    ) {
      const el = document.createElement('video');
      el.preload = 'auto';
      el.muted = true;
      el.src = clip.sourcePath;
      await loadMediaElement(el);
      videoEls.set(clip.sourcePath, el);
    }
  }

  // ---- Render audio offline ----
  let renderedAudio: AudioBuffer | null = null;
  try {
    renderedAudio = await renderAudioOffline(sortedClips, tracks, totalDuration);
    const rms = computeRMS(renderedAudio);
    console.log('[Export] Offline audio rendered, RMS:', rms.toFixed(6));
    if (rms < 0.0001) {
      console.warn('[Export] Audio is silent, discarding');
      renderedAudio = null;
    }
  } catch (err) {
    console.warn('[Export] Offline audio rendering failed:', err);
  }

  if (!renderedAudio) {
    try {
      renderedAudio = await captureAudioRealTime(sortedClips, tracks, totalDuration,
        (p) => onProgress(Math.round(p * 10)));
      const rms = computeRMS(renderedAudio);
      console.log('[Export] Real-time audio captured, RMS:', rms.toFixed(6));
      if (rms < 0.0001) { renderedAudio = null; }
    } catch (err) {
      console.warn('[Export] Real-time audio capture failed:', err);
    }
  }

  // ---- Encode H.264 video → video-only MP4 via mp4-muxer ----
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
    latencyMode: 'quality', avc: { format: 'avc' },
  });

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const totalFrames = Math.ceil(totalDuration * fps);
  const keyFrameInterval = fps * 2;

  console.log('[Export] Encoding', totalFrames, 'video frames...');

  for (let fi = 0; fi < totalFrames; fi++) {
    const time = fi / fps;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    const vis = findActiveVisualClip(sortedClips, tracks, time);
    if (vis) {
      if (vis.type === 'image') {
        const img = imageEls.get(vis.sourcePath);
        if (img) drawFit(ctx, img, w, h);
      } else if (vis.type === 'video') {
        const vid = videoEls.get(vis.sourcePath);
        if (vid) {
          await seekVideo(vid, vis.start + (time - vis.offset) * vis.speed);
          drawFit(ctx, vid, w, h);
        }
      }
    }

    const frame = new VideoFrame(canvas, { timestamp: Math.round(time * 1_000_000) });
    videoEncoder.encode(frame, { keyFrame: fi % keyFrameInterval === 0 });
    frame.close();

    if (fi % 5 === 0) {
      onProgress(10 + Math.round((fi / totalFrames) * 60));
      await yieldToUI();
    }
  }

  await videoEncoder.flush();
  videoEncoder.close();
  console.log('[Export] Video encoding complete');

  muxer.finalize();
  const videoOnlyBuf = (muxer.target as ArrayBufferTarget).buffer;
  const videoOnlyBlob = new Blob([videoOnlyBuf], { type: 'video/mp4' });
  console.log('[Export] Video-only MP4:', (videoOnlyBuf.byteLength / 1024 / 1024).toFixed(2), 'MB');

  // ---- Add AAC audio via ffmpeg.wasm ----
  let finalBlob = videoOnlyBlob;

  if (renderedAudio) {
    onProgress(75);
    console.log('[Export] Adding AAC audio via ffmpeg.wasm...');

    const withAudio = await muxVideoWithAAC(
      videoOnlyBlob,
      renderedAudio,
      audioBitrate,
      (r) => onProgress(75 + Math.round(r * 20)),
    );

    if (withAudio) {
      finalBlob = withAudio;
      console.log('[Export] AAC audio added successfully');
    } else {
      console.warn('[Export] ffmpeg.wasm failed — exporting video-only MP4');
    }
  } else {
    console.warn('[Export] No audio available — exporting video-only MP4');
  }

  // Cleanup source elements
  videoEls.forEach((el) => { el.pause(); el.removeAttribute('src'); el.load(); });

  onProgress(100);
  const filename = `export_${Date.now()}.mp4`;
  console.log('[Export] Done:', (finalBlob.size / 1024 / 1024).toFixed(2), 'MB');
  onComplete(finalBlob, filename);
}

// ---------------------------------------------------------------------------
// PATH B: No WebCodecs → MediaRecorder WebM → ffmpeg.wasm converts to MP4
// ---------------------------------------------------------------------------
async function exportMP4ViaWebM(
  clips: Clip[],
  tracks: Track[],
  settings: ExportSettings,
  { onProgress, onComplete, onError }: ExportCallbacks,
) {
  console.log('[Export] MP4 via WebM capture + ffmpeg.wasm conversion');
  const audioBitrate = AUDIO_BITRATE_MAP[settings.quality];

  const webmBlob = await captureWebM(clips, tracks, settings, (p) => {
    onProgress(Math.round(p * 50));
  });

  if (!webmBlob) { onError('WebM capture failed'); return; }

  console.log('[Export] WebM captured:', (webmBlob.size / 1024 / 1024).toFixed(2), 'MB');
  onProgress(55);

  const mp4Blob = await convertWebMToMP4(
    webmBlob, audioBitrate,
    (r) => onProgress(55 + Math.round(r * 40)),
  );

  if (mp4Blob) {
    onProgress(100);
    onComplete(mp4Blob, `export_${Date.now()}.mp4`);
  } else {
    console.warn('[Export] ffmpeg conversion failed, delivering WebM instead');
    onProgress(100);
    onComplete(webmBlob, `export_${Date.now()}.webm`);
  }
}

// ---------------------------------------------------------------------------
// PATH C: Direct WebM export via MediaRecorder
// ---------------------------------------------------------------------------
async function exportWebM(
  clips: Clip[],
  tracks: Track[],
  settings: ExportSettings,
  { onProgress, onComplete, onError }: ExportCallbacks,
) {
  const webmBlob = await captureWebM(clips, tracks, settings, (p) => {
    onProgress(Math.round(p * 100));
  });

  if (!webmBlob) { onError('Export failed'); return; }

  onProgress(100);
  onComplete(webmBlob, `export_${Date.now()}.webm`);
}

// ---------------------------------------------------------------------------
// Shared: Capture timeline to WebM using MediaRecorder
// ---------------------------------------------------------------------------
async function captureWebM(
  clips: Clip[],
  tracks: Track[],
  settings: ExportSettings,
  onProgress: (fraction: number) => void,
): Promise<Blob | null> {
  const [w, h] = settings.resolution.split('x').map(Number);
  const fps = settings.fps;
  const videoBitrate = BITRATE_MAP[settings.quality];
  const sortedClips = [...clips].sort((a, b) => a.offset - b.offset);
  const totalDuration = Math.max(
    ...sortedClips.map((c) => c.offset + (c.end - c.start) / c.speed),
  );

  console.log('[WebM] Starting capture', { w, h, fps, duration: totalDuration.toFixed(2), clips: sortedClips.length });

  if (totalDuration <= 0) {
    console.error('[WebM] totalDuration is 0, nothing to capture');
    return null;
  }

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
    console.log('[WebM] AudioContext created, state:', audioCtx.state);
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

  for (const clip of sortedClips) {
    if (clip.type === 'image') {
      const img = new Image();
      img.src = clip.sourcePath;
      await loadImage(img);
      states.push({ clip, element: img, gainNode: null });
      console.log('[WebM] Loaded image:', clip.sourceName);
      continue;
    }

    const el = clip.type === 'audio'
      ? document.createElement('audio')
      : document.createElement('video');
    el.preload = 'auto';
    el.src = clip.sourcePath;
    await loadMediaElement(el);
    console.log('[WebM] Loaded media:', clip.sourceName, 'readyState:', el.readyState);

    let gainNode: GainNode | null = null;
    try {
      const srcNode = audioCtx.createMediaElementSource(el);
      gainNode = audioCtx.createGain();
      gainNode.gain.value = 0;
      srcNode.connect(gainNode);
      gainNode.connect(audioDestination);
    } catch (err) {
      console.warn('[WebM] Audio connect failed for', clip.sourceName, ':', err);
    }

    states.push({ clip, element: el, gainNode });
  }

  if (states.length === 0) {
    console.error('[WebM] No clips could be loaded');
    audioCtx.close().catch(() => {});
    return null;
  }

  let canvasStream: MediaStream;
  try {
    canvasStream = canvas.captureStream(fps);
    console.log('[WebM] Canvas stream tracks:', canvasStream.getVideoTracks().length);
  } catch (err) {
    console.error('[WebM] canvas.captureStream() failed:', err);
    audioCtx.close().catch(() => {});
    return null;
  }

  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);
  console.log('[WebM] Combined stream — video tracks:', combinedStream.getVideoTracks().length,
    'audio tracks:', combinedStream.getAudioTracks().length);

  const mimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mimeType = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m));

  if (!mimeType) {
    console.error('[WebM] No supported MediaRecorder mime type found!');
    console.log('[WebM] Tested:', mimeTypes.map(m => `${m}: ${MediaRecorder.isTypeSupported(m)}`));
    audioCtx.close().catch(() => {});
    return null;
  }

  console.log('[WebM] Using mime type:', mimeType);

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: videoBitrate,
    });
  } catch (err) {
    console.error('[WebM] MediaRecorder creation failed:', err);
    audioCtx.close().catch(() => {});
    return null;
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

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

      console.log('[WebM] Recording stopped, chunks:', chunks.length);
      if (chunks.length === 0) {
        console.error('[WebM] No data chunks recorded!');
        resolve(null);
        return;
      }
      const blob = new Blob(chunks, { type: mimeType });
      console.log('[WebM] Final blob:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
      resolve(blob);
    };

    recorder.onerror = (e) => {
      console.error('[WebM] MediaRecorder error:', e);
      resolve(null);
    };

    recorder.start(100);
    console.log('[WebM] Recording started');
    const startWall = performance.now();

    function render() {
      const elapsed = (performance.now() - startWall) / 1000;

      if (elapsed >= totalDuration) {
        onProgress(1);
        setTimeout(() => recorder.stop(), 300);
        return;
      }

      onProgress(Math.min(0.99, elapsed / totalDuration));

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      let drewVisual = false;
      for (const { clip, element, gainNode } of states) {
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

        if (element instanceof HTMLImageElement) {
          if (!drewVisual) { drawFit(ctx, element, w, h); drewVisual = true; }
        } else if (element instanceof HTMLMediaElement) {
          const srcTime = clip.start + (elapsed - clip.offset) * clip.speed;
          element.playbackRate = clip.speed;

          if (element.paused) {
            element.currentTime = srcTime;
            element.play().catch(() => {});
          } else if (Math.abs(element.currentTime - srcTime) > 0.3) {
            element.currentTime = srcTime;
          }

          if (element instanceof HTMLVideoElement && clip.type === 'video' && !drewVisual) {
            drawFit(ctx, element, w, h);
            drewVisual = true;
          }
        }
      }

      requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
  });
}

// ---------------------------------------------------------------------------
// Offline audio rendering
// ---------------------------------------------------------------------------
async function renderAudioOffline(
  clips: Clip[],
  tracks: Track[],
  duration: number,
): Promise<AudioBuffer> {
  const totalSamples = Math.ceil(duration * SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(AUDIO_CHANNELS, totalSamples, SAMPLE_RATE);

  const decodeCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await decodeCtx.resume();

  const audioClips = clips.filter((c) => c.type !== 'image');
  let decodedCount = 0;

  console.log('[Audio:Offline] Processing', audioClips.length, 'audio-bearing clips');

  for (const clip of audioClips) {
    const track = tracks[clip.track];
    if (track?.muted) continue;

    let audioBuffer: AudioBuffer;
    try {
      const resp = await fetch(clip.sourcePath);
      const arrBuf = await resp.arrayBuffer();
      audioBuffer = await decodeCtx.decodeAudioData(arrBuf);
      console.log('[Audio:Offline] Decoded', clip.sourceName, audioBuffer.duration.toFixed(2) + 's');
    } catch (err) {
      console.warn('[Audio:Offline] Failed to decode', clip.sourceName, ':', err);
      continue;
    }

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
    if (clip.fadeIn > 0) {
      gainNode.gain.linearRampToValueAtTime(baseVol, startTime + clip.fadeIn);
    }
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
  if (decodedCount === 0) throw new Error('No audio decoded from any clip');

  return await offlineCtx.startRendering();
}

// ---------------------------------------------------------------------------
// Real-time audio capture fallback
// ---------------------------------------------------------------------------
async function captureAudioRealTime(
  clips: Clip[],
  tracks: Track[],
  duration: number,
  onProgress?: (fraction: number) => void,
): Promise<AudioBuffer> {
  const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await audioCtx.resume();
  const dest = audioCtx.createMediaStreamDestination();

  interface CaptureState { clip: Clip; element: HTMLVideoElement | HTMLAudioElement; gainNode: GainNode; }
  const states: CaptureState[] = [];

  for (const clip of clips) {
    if (clip.type === 'image') continue;
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

  if (states.length === 0) {
    await audioCtx.close();
    throw new Error('No audio elements could be connected');
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function findActiveVisualClip(clips: Clip[], tracks: Track[], time: number): Clip | undefined {
  return clips.find((c) => {
    if (time < c.offset || time >= c.offset + (c.end - c.start) / c.speed) return false;
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

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.02) { resolve(); return; }
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
    setTimeout(resolve, 500);
  });
}

function loadImage(img: HTMLImageElement): Promise<void> {
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
