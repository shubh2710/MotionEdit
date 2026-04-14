import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { secondsToPixels, pixelsToSeconds, formatTime } from '../../utils/helpers';
import { processFiles, loadMediaMetadata } from '../../utils/mediaImport';
import { TimelineClip } from './TimelineClip';
import { TimelineRuler } from './TimelineRuler';

export const Timeline: React.FC = () => {
  const {
    clips, tracks, zoom, currentTime, duration,
    setCurrentTime, clearSelection, addClipToTimeline, mediaFiles, addMediaFiles,
  } = useEditorStore();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  const totalWidth = Math.max(secondsToPixels(duration + 30, zoom), 2000);
  const playheadPos = secondsToPixels(currentTime, zoom);

  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-timeline-clip]')) return;

    const container = scrollContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft;
    const time = pixelsToSeconds(x, zoom);
    setCurrentTime(Math.max(0, time));
    clearSelection();
  }, [zoom, setCurrentTime, clearSelection]);

  const handlePlayheadDrag = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);

    const container = scrollContainerRef.current;
    if (!container) return;

    const onMove = (me: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = me.clientX - rect.left + container.scrollLeft;
      setCurrentTime(Math.max(0, pixelsToSeconds(x, zoom)));
    };

    const onUp = () => {
      setIsDraggingPlayhead(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [zoom, setCurrentTime]);

  const getDropPosition = useCallback((e: React.DragEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return { offset: 0, trackIndex: 0 };

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft;
    const y = e.clientY - rect.top;
    const offset = Math.max(0, pixelsToSeconds(x, zoom));
    const trackHeight = 60;
    const headerHeight = 30;
    const trackIndex = Math.max(0, Math.floor((y - headerHeight) / trackHeight));
    return { offset, trackIndex };
  }, [zoom]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const { offset, trackIndex } = getDropPosition(e);

    const mediaId = e.dataTransfer.getData('application/media-id');
    if (mediaId) {
      const file = mediaFiles.find((f) => f.id === mediaId);
      if (!file) return;

      addClipToTimeline({
        sourceId: file.id,
        sourcePath: file.path,
        sourceName: file.name,
        type: file.type,
        start: 0,
        end: file.duration || 10,
        track: trackIndex,
        offset,
        speed: 1,
        audioVolume: 1,
        fadeIn: 0,
        fadeOut: 0,
        thumbnail: file.thumbnail,
      });
      return;
    }

    if (e.dataTransfer.files.length > 0) {
      const importedFiles = processFiles(e.dataTransfer.files);
      addMediaFiles(importedFiles);

      loadMediaMetadata(importedFiles, (readyFile) => {
        const latestFile = useEditorStore.getState().mediaFiles.find((f) => f.id === readyFile.id);
        const fileToUse = latestFile || readyFile;

        addClipToTimeline({
          sourceId: fileToUse.id,
          sourcePath: fileToUse.path,
          sourceName: fileToUse.name,
          type: fileToUse.type,
          start: 0,
          end: fileToUse.duration || 10,
          track: trackIndex,
          offset,
          speed: 1,
          audioVolume: 1,
          fadeIn: 0,
          fadeOut: 0,
          thumbnail: fileToUse.thumbnail,
        });
      });
    }
  }, [mediaFiles, zoom, addClipToTimeline, addMediaFiles, getDropPosition]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || isDraggingPlayhead) return;

    const containerWidth = container.clientWidth;
    const scrollLeft = container.scrollLeft;
    if (playheadPos < scrollLeft || playheadPos > scrollLeft + containerWidth - 100) {
      container.scrollLeft = playheadPos - containerWidth / 3;
    }
  }, [playheadPos, isDraggingPlayhead]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      useEditorStore.getState().setZoom(zoom + delta);
    }
  }, [zoom]);

  return (
    <div className="flex flex-col h-full bg-gray-950 select-none">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Timeline</h2>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="font-mono">{formatTime(currentTime)}</span>
          <span>/</span>
          <span className="font-mono">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Track labels */}
        <div className="w-32 flex-shrink-0 border-r border-gray-800 bg-gray-900/50">
          <div className="h-[30px] border-b border-gray-800" />
          {tracks.map((track) => (
            <TrackLabel key={track.id} track={track} />
          ))}
        </div>

        {/* Scrollable timeline area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto relative"
          onWheel={handleWheel}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        >
          <div style={{ width: totalWidth, minHeight: '100%' }} className="relative">
            {/* Ruler */}
            <div className="sticky top-0 z-20" onClick={handleTimelineClick}>
              <TimelineRuler width={totalWidth} zoom={zoom} />
            </div>

            {/* Track rows */}
            {tracks.map((track, index) => (
              <div
                key={track.id}
                className={`h-[60px] border-b border-gray-800/50 relative
                  ${index % 2 === 0 ? 'bg-gray-900/30' : 'bg-gray-900/10'}`}
                onClick={handleTimelineClick}
              >
                {clips
                  .filter((c) => c.track === index)
                  .map((clip) => (
                    <TimelineClip key={clip.id} clip={clip} zoom={zoom} />
                  ))}
              </div>
            ))}

            {/* Empty space for tracks with no content */}
            {tracks.length === 0 && (
              <div className="h-[180px] flex items-center justify-center text-gray-600 text-sm">
                Add tracks and drag media here
              </div>
            )}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 z-30 pointer-events-none"
              style={{ left: playheadPos }}
            >
              <div
                className="w-3 h-3 bg-red-500 rounded-b-sm -ml-1.5 cursor-col-resize pointer-events-auto"
                onMouseDown={handlePlayheadDrag}
                style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }}
              />
              <div className="w-px h-full bg-red-500 mx-auto -mt-px" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const TrackLabel: React.FC<{ track: { id: string; name: string; type: string; muted: boolean; locked: boolean } }> = ({ track }) => {
  const { toggleTrackMute, toggleTrackLock } = useEditorStore();

  return (
    <div className="h-[60px] border-b border-gray-800/50 flex items-center px-2 gap-1">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${track.type === 'video' ? 'bg-blue-500' : 'bg-green-500'}`} />
          <span className="text-[11px] font-medium text-gray-300 truncate">{track.name}</span>
        </div>
      </div>
      <button
        onClick={() => toggleTrackMute(track.id)}
        className={`w-5 h-5 flex items-center justify-center rounded text-[10px] transition-colors
          ${track.muted ? 'bg-red-900/50 text-red-400' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
        title={track.muted ? 'Unmute' : 'Mute'}
      >
        M
      </button>
      <button
        onClick={() => toggleTrackLock(track.id)}
        className={`w-5 h-5 flex items-center justify-center rounded text-[10px] transition-colors
          ${track.locked ? 'bg-yellow-900/50 text-yellow-400' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
        title={track.locked ? 'Unlock' : 'Lock'}
      >
        L
      </button>
    </div>
  );
};
