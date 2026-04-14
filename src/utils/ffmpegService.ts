import { FFmpeg } from '@ffmpeg/ffmpeg';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<boolean> | null = null;

export async function getFFmpeg(): Promise<FFmpeg | null> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  if (loadPromise) {
    await loadPromise;
    return ffmpegInstance?.loaded ? ffmpegInstance : null;
  }

  loadPromise = (async () => {
    try {
      const ffmpeg = new FFmpeg();

      // Show ffmpeg's internal logs so we can see encoding progress
      ffmpeg.on('log', ({ message }) => console.log('[FFmpeg:log]', message));

      console.log('[FFmpeg] Loading WASM core...');
      const baseURL = new URL('/ffmpeg', window.location.origin).href;
      const coreURL = `${baseURL}/ffmpeg-core.js`;
      const wasmURL = `${baseURL}/ffmpeg-core.wasm`;

      console.log('[FFmpeg] Core URL:', coreURL);
      await ffmpeg.load({ coreURL, wasmURL });
      ffmpegInstance = ffmpeg;
      console.log('[FFmpeg] Loaded successfully');
      return true;
    } catch (err) {
      console.error('[FFmpeg] Failed to load:', err);
      loadPromise = null;
      return false;
    }
  })();

  await loadPromise;
  return ffmpegInstance?.loaded ? ffmpegInstance : null;
}

/**
 * Takes a video-only MP4 blob and an AudioBuffer,
 * returns MP4 with H.264 video (copied) + AAC audio (encoded by ffmpeg).
 * This is FAST because video is just copied, only audio is encoded.
 */
export async function muxVideoWithAAC(
  videoMP4: Blob,
  audio: AudioBuffer,
  audioBitrate: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob | null> {
  const ffmpeg = await getFFmpeg();
  if (!ffmpeg) return null;

  const progressCb = onProgress
    ? ({ progress }: { progress: number }) => onProgress(clamp01(progress))
    : undefined;

  try {
    if (progressCb) ffmpeg.on('progress', progressCb);

    const videoSize = videoMP4.size;
    const videoData = new Uint8Array(await videoMP4.arrayBuffer());
    await ffmpeg.writeFile('video.mp4', videoData);
    console.log('[FFmpeg] Wrote video.mp4:', mb(videoSize));

    const pcm = interleaveAudioBuffer(audio);
    const audioSize = pcm.byteLength;
    await ffmpeg.writeFile('audio.raw', new Uint8Array(pcm.buffer));
    console.log('[FFmpeg] Wrote audio.raw:', mb(audioSize));

    const exitCode = await ffmpeg.exec([
      '-i', 'video.mp4',
      '-f', 'f32le', '-ar', String(audio.sampleRate), '-ac', String(audio.numberOfChannels),
      '-i', 'audio.raw',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', String(audioBitrate),
      '-shortest',
      'output.mp4',
    ]);

    if (progressCb) ffmpeg.off('progress', progressCb);

    if (exitCode !== 0) {
      console.error('[FFmpeg] mux failed, exit code:', exitCode);
      await cleanup(ffmpeg, ['video.mp4', 'audio.raw', 'output.mp4']);
      return null;
    }

    const output = await ffmpeg.readFile('output.mp4');
    await cleanup(ffmpeg, ['video.mp4', 'audio.raw', 'output.mp4']);

    if (typeof output === 'string') return null;
    console.log('[FFmpeg] Output MP4:', mb(output.byteLength));
    return new Blob([output.buffer], { type: 'video/mp4' });
  } catch (err) {
    console.error('[FFmpeg] muxVideoWithAAC error:', err);
    if (progressCb) ffmpeg.off('progress', progressCb);
    await cleanup(ffmpeg, ['video.mp4', 'audio.raw', 'output.mp4']);
    return null;
  }
}

/**
 * Converts a WebM blob to MP4 (re-encodes video as H.264, audio as AAC).
 * WARNING: This is SLOW because video must be re-encoded in WASM.
 * Use ultrafast preset to minimize encoding time.
 */
export async function convertWebMToMP4(
  webmBlob: Blob,
  audioBitrate: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob | null> {
  const ffmpeg = await getFFmpeg();
  if (!ffmpeg) return null;

  const progressCb = onProgress
    ? ({ progress }: { progress: number }) => onProgress(clamp01(progress))
    : undefined;

  try {
    if (progressCb) ffmpeg.on('progress', progressCb);

    const inputSize = webmBlob.size;
    console.log('[FFmpeg] Input WebM blob size:', mb(inputSize));
    const inputData = new Uint8Array(await webmBlob.arrayBuffer());
    await ffmpeg.writeFile('input.webm', inputData);
    console.log('[FFmpeg] Wrote input.webm to virtual FS');

    console.log('[FFmpeg] Starting VP9→H.264 re-encode (this may take a while in WASM)...');
    const exitCode = await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', String(audioBitrate),
      '-movflags', '+faststart',
      'output.mp4',
    ]);

    if (progressCb) ffmpeg.off('progress', progressCb);

    if (exitCode !== 0) {
      console.error('[FFmpeg] conversion failed, exit code:', exitCode);
      await cleanup(ffmpeg, ['input.webm', 'output.mp4']);
      return null;
    }

    const output = await ffmpeg.readFile('output.mp4');
    await cleanup(ffmpeg, ['input.webm', 'output.mp4']);

    if (typeof output === 'string') return null;
    console.log('[FFmpeg] Converted to MP4:', mb(output.byteLength));
    return new Blob([output.buffer], { type: 'video/mp4' });
  } catch (err) {
    console.error('[FFmpeg] convertWebMToMP4 error:', err);
    if (progressCb) ffmpeg.off('progress', progressCb);
    await cleanup(ffmpeg, ['input.webm', 'output.mp4']);
    return null;
  }
}

function interleaveAudioBuffer(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels: ch, length } = buffer;
  const out = new Float32Array(length * ch);
  const channels: Float32Array[] = [];
  for (let c = 0; c < ch; c++) channels.push(buffer.getChannelData(c));

  for (let i = 0; i < length; i++) {
    for (let c = 0; c < ch; c++) {
      out[i * ch + c] = channels[c][i];
    }
  }
  return out;
}

async function cleanup(ffmpeg: FFmpeg, files: string[]) {
  for (const f of files) {
    try { await ffmpeg.deleteFile(f); } catch { /* ignore */ }
  }
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }
function mb(bytes: number) { return (bytes / 1024 / 1024).toFixed(2) + ' MB'; }
