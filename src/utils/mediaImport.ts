import { useEditorStore } from '../store/editorStore';
import { detectMediaType, generateId, generateVideoThumbnail } from './helpers';
import { MediaFile } from './types';

const DEFAULT_IMAGE_DURATION = 5;

export function processFiles(fileList: FileList | File[]): MediaFile[] {
  return Array.from(fileList).map((f) => ({
    id: generateId(),
    name: f.name,
    path: URL.createObjectURL(f),
    type: detectMediaType(f.name),
    duration: 0,
    fileSize: f.size,
    file: f,
  }));
}

export function loadMediaMetadata(files: MediaFile[], onReady?: (file: MediaFile) => void) {
  const store = useEditorStore.getState();

  files.forEach((f) => {
    if (f.type === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      video.onloadedmetadata = () => {
        store.updateMediaFile(f.id, {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        });

        const updatedFile = { ...f, duration: video.duration, width: video.videoWidth, height: video.videoHeight };
        onReady?.(updatedFile);

        generateVideoThumbnail(f.path)
          .then((thumb) => store.updateMediaFile(f.id, { thumbnail: thumb }))
          .catch(() => {});
      };

      video.onerror = () => {
        console.warn(`Could not load metadata for: ${f.name}`);
        onReady?.(f);
      };

      video.src = f.path;
    } else if (f.type === 'audio') {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';

      audio.onloadedmetadata = () => {
        store.updateMediaFile(f.id, { duration: audio.duration });
        onReady?.({ ...f, duration: audio.duration });
      };

      audio.onerror = () => {
        console.warn(`Could not load metadata for: ${f.name}`);
        onReady?.(f);
      };

      audio.src = f.path;
    } else if (f.type === 'image') {
      store.updateMediaFile(f.id, {
        duration: DEFAULT_IMAGE_DURATION,
        thumbnail: f.path,
      });

      const img = new Image();
      img.onload = () => {
        store.updateMediaFile(f.id, {
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.src = f.path;

      onReady?.({ ...f, duration: DEFAULT_IMAGE_DURATION, thumbnail: f.path });
    }
  });
}
