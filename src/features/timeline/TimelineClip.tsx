import React, { useRef, useState, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { secondsToPixels, pixelsToSeconds, formatTime, clamp } from '../../utils/helpers';
import { Clip } from '../../utils/types';

interface TimelineClipProps {
  clip: Clip;
  zoom: number;
}

export const TimelineClip: React.FC<TimelineClipProps> = ({ clip, zoom }) => {
  const { selectClip, updateClip, selectedClipIds, splitClipAtPlayhead, removeClip, currentTime } = useEditorStore();
  const clipRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const clipDuration = (clip.end - clip.start) / clip.speed;
  const left = secondsToPixels(clip.offset, zoom);
  const width = secondsToPixels(clipDuration, zoom);
  const isSelected = selectedClipIds.includes(clip.id);

  const clipTimeEnd = clip.offset + clipDuration;
  const playheadIsOnClip = currentTime > clip.offset && currentTime < clipTimeEnd;

  const colorMap = {
    video: { bg: 'bg-blue-600/40', border: 'border-blue-500', text: 'text-blue-300', ring: 'ring-blue-400', hoverBg: 'hover:bg-blue-600/50' },
    audio: { bg: 'bg-green-600/40', border: 'border-green-500', text: 'text-green-300', ring: 'ring-green-400', hoverBg: 'hover:bg-green-600/50' },
    image: { bg: 'bg-purple-600/40', border: 'border-purple-500', text: 'text-purple-300', ring: 'ring-purple-400', hoverBg: 'hover:bg-purple-600/50' },
  };
  const colors = colorMap[clip.type];

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.closest('[data-clip-action]')) return;

    selectClip(clip.id, e.shiftKey);

    setIsDragging(true);
    const startX = e.clientX;
    const startOffset = clip.offset;
    let moved = false;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      if (moved) {
        const newOffset = Math.max(0, startOffset + pixelsToSeconds(dx, zoom));
        updateClip(clip.id, { offset: newOffset });
      }
    };

    const onUp = () => {
      setIsDragging(false);
      if (moved) useEditorStore.getState().recalculateDuration();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [clip.id, clip.offset, zoom, selectClip, updateClip]);

  const handleResizeStart = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    selectClip(clip.id);

    const startX = e.clientX;
    const startLeft = clip.start;
    const startRight = clip.end;
    const startOffset = clip.offset;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const timeDelta = pixelsToSeconds(dx, zoom) * clip.speed;

      if (side === 'left') {
        const newStart = clamp(startLeft + timeDelta, 0, startRight - 0.1);
        const newOffset = startOffset + (newStart - startLeft) / clip.speed;
        updateClip(clip.id, { start: newStart, offset: newOffset });
      } else {
        const newEnd = Math.max(startLeft + 0.1, startRight + timeDelta);
        updateClip(clip.id, { end: newEnd });
      }
    };

    const onUp = () => {
      useEditorStore.getState().recalculateDuration();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [clip, zoom, selectClip, updateClip]);

  const handleSplit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    splitClipAtPlayhead(clip.id);
  }, [clip.id, splitClipAtPlayhead]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    removeClip(clip.id);
  }, [clip.id, removeClip]);

  return (
    <div
      ref={clipRef}
      data-timeline-clip
      className={`absolute top-1 bottom-1 rounded-md border overflow-hidden cursor-grab transition-shadow group/clip
        ${colors.bg} ${colors.border}
        ${isSelected ? `ring-2 ${colors.ring} ring-opacity-50` : ''}
        ${isDragging ? 'opacity-80 cursor-grabbing shadow-lg' : 'hover:brightness-110'}`}
      style={{ left, width: Math.max(width, 4) }}
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-white/20 transition-colors"
        onMouseDown={(e) => handleResizeStart('left', e)}
      />

      {/* Thumbnail background for image/video clips */}
      {clip.thumbnail && (
        <img
          src={clip.thumbnail}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none"
        />
      )}

      {/* Fade in overlay */}
      {clip.fadeIn > 0 && (
        <div
          className="absolute top-0 bottom-0 left-0 pointer-events-none z-[1]"
          style={{
            width: `${Math.min(100, (clip.fadeIn / clipDuration) * 100)}%`,
            background: 'linear-gradient(to right, rgba(0,0,0,0.5), transparent)',
          }}
        />
      )}

      {/* Fade out overlay */}
      {clip.fadeOut > 0 && (
        <div
          className="absolute top-0 bottom-0 right-0 pointer-events-none z-[1]"
          style={{
            width: `${Math.min(100, (clip.fadeOut / clipDuration) * 100)}%`,
            background: 'linear-gradient(to left, rgba(0,0,0,0.5), transparent)',
          }}
        />
      )}

      {/* Clip content */}
      <div className="relative px-2 py-1 h-full flex flex-col justify-center overflow-hidden pointer-events-none z-[2]">
        <span className={`text-[10px] font-medium truncate ${colors.text}`}>
          {clip.sourceName}
        </span>
        <span className="text-[9px] text-gray-400 truncate">
          {formatTime(clip.start)} - {formatTime(clip.end)}
          {clip.speed !== 1 && ` (${clip.speed}x)`}
        </span>
      </div>

      {/* Action buttons - visible on hover or when selected */}
      <div className={`absolute top-0.5 right-3 flex items-center gap-0.5 transition-opacity z-20
        ${isSelected ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100'}`}>
        {playheadIsOnClip && (
          <button
            data-clip-action="split"
            onClick={handleSplit}
            title="Split at playhead"
            className="w-5 h-5 flex items-center justify-center rounded bg-black/60 hover:bg-yellow-600 text-gray-300 hover:text-white transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16M8 8l-4 4 4 4M16 8l4 4-4 4" />
            </svg>
          </button>
        )}
        <button
          data-clip-action="delete"
          onClick={handleDelete}
          title="Delete clip"
          className="w-5 h-5 flex items-center justify-center rounded bg-black/60 hover:bg-red-600 text-gray-300 hover:text-white transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-white/20 transition-colors"
        onMouseDown={(e) => handleResizeStart('right', e)}
      />
    </div>
  );
};
