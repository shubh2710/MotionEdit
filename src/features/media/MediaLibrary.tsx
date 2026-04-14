import React, { useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { detectMediaType, formatTime, formatFileSize, generateId } from '../../utils/helpers';
import { processFiles, loadMediaMetadata } from '../../utils/mediaImport';
import { MediaFile } from '../../utils/types';

const DEFAULT_IMAGE_DURATION = 5;

export const MediaLibrary: React.FC = () => {
  const { mediaFiles, addMediaFiles, removeMediaFile, setActiveMedia, activeMediaId } = useEditorStore();

  const handleImport = useCallback(async () => {
    if (window.electronAPI) {
      const paths = await window.electronAPI.openFiles();
      if (!paths?.length) return;
      const files: MediaFile[] = paths.map((p: string) => {
        const name = p.split(/[/\\]/).pop() || 'unknown';
        return {
          id: generateId(),
          name,
          path: p,
          type: detectMediaType(name),
          duration: 0,
          fileSize: 0,
        };
      });
      addMediaFiles(files);
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = [
        'video/*', 'audio/*', 'image/*',
        '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v',
        '.3gp', '.3g2', '.ts', '.mts', '.hevc',
        '.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.wma', '.amr', '.caf',
        '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
        '.heic', '.heif', '.avif', '.tiff', '.tif', '.dng', '.raw',
      ].join(',');

      input.onchange = () => {
        if (!input.files?.length) return;
        const files = processFiles(input.files);
        addMediaFiles(files);
        loadMediaMetadata(files);
      };
      input.click();
    }
  }, [addMediaFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.getData('application/media-id')) return;

    const dt = e.dataTransfer;
    if (!dt.files.length) return;

    const files = processFiles(dt.files);
    addMediaFiles(files);
    loadMediaMetadata(files);
  }, [addMediaFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Media</h2>
        <button
          onClick={handleImport}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded-md text-xs font-medium transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Import
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto p-2"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {mediaFiles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-800 rounded-lg p-4">
            <svg className="w-10 h-10 mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium mb-1">Drop media here</p>
            <p className="text-xs text-gray-600">or click Import</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {mediaFiles.map((file) => (
              <MediaItem
                key={file.id}
                file={file}
                isActive={activeMediaId === file.id}
                onSelect={() => setActiveMedia(file.id)}
                onRemove={() => removeMediaFile(file.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const MediaItem: React.FC<{
  file: MediaFile;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}> = ({ file, isActive, onSelect, onRemove }) => {
  const addClipToTimeline = useEditorStore((s) => s.addClipToTimeline);
  const clips = useEditorStore((s) => s.clips);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/media-id', file.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDoubleClick = () => {
    const lastClipOnTrack = clips
      .filter((c) => c.track === 0)
      .sort((a, b) => (a.offset + (a.end - a.start)) - (b.offset + (b.end - b.start)))
      .pop();

    const offset = lastClipOnTrack
      ? lastClipOnTrack.offset + (lastClipOnTrack.end - lastClipOnTrack.start) / lastClipOnTrack.speed
      : 0;

    addClipToTimeline({
      sourceId: file.id,
      sourcePath: file.path,
      sourceName: file.name,
      type: file.type,
      start: 0,
      end: file.duration || DEFAULT_IMAGE_DURATION,
      track: 0,
      offset,
      speed: 1,
      audioVolume: 1,
      fadeIn: 0,
      fadeOut: 0,
      thumbnail: file.thumbnail,
    });
  };

  const typeColor = file.type === 'video' ? 'text-blue-400' : file.type === 'audio' ? 'text-green-400' : 'text-purple-400';

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      className={`group relative rounded-lg overflow-hidden cursor-pointer transition-all border
        ${isActive ? 'border-blue-500 bg-blue-950/30' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}
    >
      <div className="aspect-video bg-gray-800 flex items-center justify-center relative">
        {file.thumbnail ? (
          <img src={file.thumbnail} alt={file.name} className="w-full h-full object-cover" />
        ) : (
          <span className={typeColor}>
            {file.type === 'video' ? <VideoIcon /> : file.type === 'audio' ? <AudioIcon /> : <ImageIcon />}
          </span>
        )}
        {file.duration > 0 && (
          <span className="absolute bottom-1 right-1 bg-black/70 text-[10px] text-white px-1 rounded">
            {formatTime(file.duration)}
          </span>
        )}
        <div className="absolute top-0.5 left-1">
          <span className={`text-[9px] font-semibold uppercase px-1 py-0.5 rounded ${
            file.type === 'video' ? 'bg-blue-900/70 text-blue-300' :
            file.type === 'audio' ? 'bg-green-900/70 text-green-300' :
            'bg-purple-900/70 text-purple-300'
          }`}>
            {file.type}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
      <div className="px-2 py-1.5">
        <p className="text-[11px] font-medium truncate text-gray-200">{file.name}</p>
        {file.fileSize > 0 && (
          <p className="text-[10px] text-gray-500">{formatFileSize(file.fileSize)}</p>
        )}
      </div>
    </div>
  );
};

const VideoIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const AudioIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
  </svg>
);

const ImageIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);
