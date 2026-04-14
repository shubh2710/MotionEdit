import React, { useCallback, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { secondsToPixels, pixelsToSeconds, formatTime } from '../../utils/helpers';
import { TextOverlay, ImageOverlay } from '../../utils/types';

interface Props {
  overlay: TextOverlay | ImageOverlay;
  type: 'text' | 'image';
  zoom: number;
}

export const TimelineOverlayItem: React.FC<Props> = ({ overlay, type, zoom }) => {
  const { selectOverlay, selectedOverlayId, updateTextOverlay, updateImageOverlay, removeTextOverlay, removeImageOverlay } = useEditorStore();
  const [isDragging, setIsDragging] = useState(false);

  const duration = overlay.endTime - overlay.startTime;
  const left = secondsToPixels(overlay.startTime, zoom);
  const width = secondsToPixels(duration, zoom);
  const isSelected = selectedOverlayId === overlay.id;

  const isText = type === 'text';
  const label = isText ? (overlay as TextOverlay).text : (overlay as ImageOverlay).name;

  const bgClass = isText ? 'bg-amber-600/40' : 'bg-pink-600/40';
  const borderClass = isText ? 'border-amber-500' : 'border-pink-500';
  const textClass = isText ? 'text-amber-300' : 'text-pink-300';
  const ringClass = isText ? 'ring-amber-400' : 'ring-pink-400';

  const update = useCallback(
    (updates: Partial<TextOverlay> | Partial<ImageOverlay>) => {
      if (isText) updateTextOverlay(overlay.id, updates);
      else updateImageOverlay(overlay.id, updates as Partial<ImageOverlay>);
    },
    [overlay.id, isText, updateTextOverlay, updateImageOverlay],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    if (target.closest('[data-clip-action]')) return;

    selectOverlay(overlay.id, type);
    setIsDragging(true);
    const startX = e.clientX;
    const startTime = overlay.startTime;
    const endTime = overlay.endTime;
    let moved = false;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      if (moved) {
        const timeDelta = pixelsToSeconds(dx, zoom);
        const newStart = Math.max(0, startTime + timeDelta);
        const dur = endTime - startTime;
        update({ startTime: newStart, endTime: newStart + dur });
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
  }, [overlay.id, overlay.startTime, overlay.endTime, type, zoom, selectOverlay, update]);

  const handleResize = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    selectOverlay(overlay.id, type);

    const startX = e.clientX;
    const origStart = overlay.startTime;
    const origEnd = overlay.endTime;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const timeDelta = pixelsToSeconds(dx, zoom);

      if (side === 'left') {
        const newStart = Math.max(0, Math.min(origEnd - 0.1, origStart + timeDelta));
        update({ startTime: newStart });
      } else {
        const newEnd = Math.max(origStart + 0.1, origEnd + timeDelta);
        update({ endTime: newEnd });
      }
    };

    const onUp = () => {
      useEditorStore.getState().recalculateDuration();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [overlay, type, zoom, selectOverlay, update]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isText) removeTextOverlay(overlay.id);
    else removeImageOverlay(overlay.id);
  }, [overlay.id, isText, removeTextOverlay, removeImageOverlay]);

  return (
    <div
      data-timeline-clip
      className={`absolute top-1 bottom-1 rounded-md border overflow-hidden cursor-grab transition-shadow group/clip
        ${bgClass} ${borderClass}
        ${isSelected ? `ring-2 ${ringClass} ring-opacity-50` : ''}
        ${isDragging ? 'opacity-80 cursor-grabbing shadow-lg' : 'hover:brightness-110'}`}
      style={{ left, width: Math.max(width, 4) }}
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-white/20 transition-colors"
        onMouseDown={(e) => handleResize('left', e)}
      />

      <div className="relative px-2 py-1 h-full flex items-center overflow-hidden pointer-events-none z-[2]">
        <span className="text-[9px] mr-1 opacity-60">{isText ? 'T' : '🖼'}</span>
        <span className={`text-[10px] font-medium truncate ${textClass}`}>
          {label}
        </span>
        <span className="text-[9px] text-gray-400 ml-auto flex-shrink-0 pl-1">
          {formatTime(duration)}
        </span>
      </div>

      <div className={`absolute top-0.5 right-3 flex items-center gap-0.5 transition-opacity z-20
        ${isSelected ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100'}`}>
        <button
          data-clip-action="delete"
          onClick={handleDelete}
          title="Delete"
          className="w-5 h-5 flex items-center justify-center rounded bg-black/60 hover:bg-red-600 text-gray-300 hover:text-white transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-white/20 transition-colors"
        onMouseDown={(e) => handleResize('right', e)}
      />
    </div>
  );
};
