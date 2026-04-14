import { MediaType, Clip } from './types';

const VIDEO_EXTENSIONS = [
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'ogv',
  'm4v', '3gp', '3g2', 'ts', 'mts', 'm2ts',
  'hevc', 'h264', 'h265', 'divx', 'vob',
  'asf', 'rm', 'rmvb', 'mpg', 'mpeg', 'mpe', 'mp2',
  'f4v', 'swf',
];

const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'ogg', 'aac', 'flac', 'wma', 'm4a',
  'opus', 'aiff', 'aif', 'ape', 'alac', 'mid', 'midi',
  'amr', 'caf', '3ga',
];

const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
  'heic', 'heif', 'avif', 'tiff', 'tif',
  'ico', 'raw', 'cr2', 'nef', 'arw', 'dng',
  'jfif', 'pjpeg', 'pjp',
];

export function detectMediaType(filename: string): MediaType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  return 'video';
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function pixelsToSeconds(px: number, zoom: number): number {
  return px / (zoom * 10);
}

export function secondsToPixels(seconds: number, zoom: number): number {
  return seconds * zoom * 10;
}

export function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function computeEffectiveVolume(clip: Clip, currentTime: number, trackMuted: boolean): number {
  if (trackMuted) return 0;

  const clipDuration = (clip.end - clip.start) / clip.speed;
  const elapsed = currentTime - clip.offset;
  const remaining = clipDuration - elapsed;

  let fadeMul = 1;
  if (clip.fadeIn > 0 && elapsed < clip.fadeIn) {
    fadeMul = elapsed / clip.fadeIn;
  }
  if (clip.fadeOut > 0 && remaining < clip.fadeOut) {
    fadeMul = Math.min(fadeMul, remaining / clip.fadeOut);
  }

  return clamp(clip.audioVolume * Math.max(0, fadeMul), 0, 2);
}

export function generateVideoThumbnail(blobUrl: string, timeSeconds = 1): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      const seekTo = Math.min(timeSeconds, video.duration * 0.1 || 0.5);
      video.currentTime = seekTo;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 192;
        canvas.height = Math.round(192 * (video.videoHeight / video.videoWidth)) || 108;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl);
        } else {
          reject(new Error('Could not get canvas context'));
        }
      } catch {
        reject(new Error('Canvas draw failed'));
      }
    };

    video.onerror = () => reject(new Error('Video load failed for thumbnail'));

    setTimeout(() => reject(new Error('Thumbnail generation timed out')), 10000);

    video.src = blobUrl;
  });
}
