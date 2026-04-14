import type { ExportData, ExportCallbacks } from './browserExport';
import { downloadBlob } from './browserExport';

const SERVICE_URL = 'http://localhost:9876';

export interface LocalServiceInfo {
  available: boolean;
  encoder: string;
  ffmpeg: string;
}

export async function checkLocalService(): Promise<LocalServiceInfo> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { available: false, encoder: '', ffmpeg: '' };
    const data = await res.json();
    return {
      available: data.ffmpeg_available === true,
      encoder: data.encoder || 'libx264',
      ffmpeg: data.ffmpeg || 'ffmpeg',
    };
  } catch {
    return { available: false, encoder: '', ffmpeg: '' };
  }
}

export async function exportViaLocalService(
  data: ExportData,
  callbacks: ExportCallbacks,
): Promise<void> {
  const { onProgress, onStatus, onComplete, onError } = callbacks;
  const exportStart = performance.now();
  const elapsed = () => performance.now() - exportStart;

  onProgress(0);
  onStatus({ phase: 'Preparing', detail: 'Collecting media files…', step: 1, totalSteps: 4, elapsedMs: 0 });

  // Build FormData with timeline JSON and all media files
  const formData = new FormData();

  // Collect unique source paths, upload them, and build a blob-URL -> filename map
  const uploaded = new Set<string>();
  const allSources: { path: string; name: string }[] = [];
  const pathToFileName: Record<string, string> = {};

  for (const clip of data.clips) {
    if (clip.type === 'blank' || !clip.sourcePath) continue;
    if (uploaded.has(clip.sourcePath)) continue;
    uploaded.add(clip.sourcePath);
    allSources.push({ path: clip.sourcePath, name: clip.sourceName || `clip_${clip.id}` });
  }

  for (const io of data.imageOverlays) {
    if (!io.src || uploaded.has(io.src)) continue;
    uploaded.add(io.src);
    allSources.push({ path: io.src, name: io.name || `overlay_${io.id}` });
  }

  onStatus({ phase: 'Uploading', detail: `Sending ${allSources.length} file(s) to local service…`, step: 1, totalSteps: 4, elapsedMs: elapsed() });

  for (const source of allSources) {
    try {
      const response = await fetch(source.path);
      const blob = await response.blob();
      const ext = guessExtension(blob.type, source.name);
      const fileName = sanitizeName(source.name, ext);
      formData.append('files', blob, fileName);
      pathToFileName[source.path] = fileName;
    } catch (err) {
      console.warn('[LocalExport] Failed to fetch source:', source.path, err);
    }
  }

  // Rewrite timeline so sourcePath/src use the uploaded filenames instead of blob URLs
  const rewrittenClips = data.clips.map((c) => ({
    ...c,
    sourcePath: pathToFileName[c.sourcePath] || c.sourcePath,
  }));
  const rewrittenImageOverlays = data.imageOverlays.map((io) => ({
    ...io,
    src: pathToFileName[io.src] || io.src,
  }));

  const timeline = {
    clips: rewrittenClips,
    tracks: data.tracks,
    textOverlays: data.textOverlays,
    imageOverlays: rewrittenImageOverlays,
    transitions: data.transitions,
    settings: data.settings,
  };
  formData.append('timeline', JSON.stringify(timeline));

  onProgress(5);
  onStatus({ phase: 'Uploading', detail: 'Sending to FFmpeg service…', step: 2, totalSteps: 4, elapsedMs: elapsed() });

  // Start the export job
  let jobId: string;
  try {
    const res = await fetch(`${SERVICE_URL}/export`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text();
      onError(`Export service error: ${text}`);
      return;
    }
    const result = await res.json();
    jobId = result.job_id;
  } catch (err) {
    onError(`Cannot reach export service: ${err}`);
    return;
  }

  onProgress(10);
  onStatus({ phase: 'Encoding', detail: 'FFmpeg is processing…', step: 3, totalSteps: 4, elapsedMs: elapsed() });

  // Listen for progress via SSE
  try {
    await new Promise<void>((resolve, reject) => {
      const eventSource = new EventSource(`${SERVICE_URL}/export/${jobId}/progress`);

      eventSource.addEventListener('progress', (e) => {
        try {
          const p = JSON.parse(e.data);
          const pct = 10 + Math.min(80, Math.round((p.frame || 0) / Math.max(1, estimateTotalFrames(data)) * 80));
          onProgress(pct);

          const speedStr = p.speed > 0 ? `${p.speed.toFixed(1)}x realtime` : '';
          const fpsStr = p.fps > 0 ? `${p.fps.toFixed(0)} fps` : '';
          const detail = [
            `Frame ${p.frame}`,
            fpsStr,
            speedStr,
            p.out_time !== '00:00:00.00' ? p.out_time : '',
          ].filter(Boolean).join(' · ');

          onStatus({
            phase: 'Encoding (FFmpeg)',
            detail,
            step: 3,
            totalSteps: 4,
            currentFrame: p.frame,
            fps: p.fps,
            elapsedMs: elapsed(),
          });
        } catch {}
      });

      eventSource.addEventListener('done', (e) => {
        eventSource.close();
        try {
          const p = JSON.parse(e.data);
          onStatus({
            phase: 'Downloading',
            detail: `Encoding done (${p.size_mb || '?'} MB in ${p.elapsed_s || '?'}s) — downloading…`,
            step: 4, totalSteps: 4, elapsedMs: elapsed(),
          });
        } catch {}
        onProgress(92);
        resolve();
      });

      eventSource.addEventListener('error', (e) => {
        eventSource.close();
        if (e instanceof MessageEvent) {
          try {
            const p = JSON.parse(e.data);
            reject(new Error(p.error || 'FFmpeg encoding failed'));
            return;
          } catch {}
        }
        reject(new Error('Lost connection to export service'));
      });

      eventSource.onerror = () => {
        eventSource.close();
        reject(new Error('SSE connection lost'));
      };
    });
  } catch (err) {
    onError(`FFmpeg export failed: ${err}`);
    cleanup(jobId);
    return;
  }

  // Download the result
  try {
    const res = await fetch(`${SERVICE_URL}/export/${jobId}/download`);
    if (!res.ok) {
      onError('Failed to download exported file');
      cleanup(jobId);
      return;
    }
    const blob = await res.blob();
    onProgress(100);
    const filename = `export_${Date.now()}.mp4`;
    onComplete(blob, filename);
  } catch (err) {
    onError(`Download failed: ${err}`);
  } finally {
    cleanup(jobId);
  }
}

function cleanup(jobId: string) {
  fetch(`${SERVICE_URL}/export/${jobId}`, { method: 'DELETE' }).catch(() => {});
}

function estimateTotalFrames(data: ExportData): number {
  let maxEnd = 0;
  for (const c of data.clips) maxEnd = Math.max(maxEnd, c.offset + (c.end - c.start) / c.speed);
  return Math.ceil(maxEnd * data.settings.fps);
}

function guessExtension(mimeType: string, name: string): string {
  if (mimeType.includes('mp4') || mimeType.includes('quicktime')) return '.mp4';
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('avi')) return '.avi';
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
  if (mimeType.includes('gif')) return '.gif';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('audio/mpeg')) return '.mp3';
  if (mimeType.includes('audio/wav')) return '.wav';

  const dotIdx = name.lastIndexOf('.');
  if (dotIdx >= 0) return name.slice(dotIdx);
  return '.mp4';
}

function sanitizeName(name: string, ext: string): string {
  let base = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base.includes('.')) base += ext;
  return base;
}
