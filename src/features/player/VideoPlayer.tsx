import React, { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { formatTime, computeEffectiveVolume } from '../../utils/helpers';

export const VideoPlayer: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSourceRef = useRef<string | null>(null);
  const {
    clips, tracks, currentTime, isPlaying, duration,
    setCurrentTime, setIsPlaying, activeMediaId, mediaFiles,
  } = useEditorStore();

  const hasTimelineClips = clips.length > 0;

  const activeClip = clips.find((c) => {
    const clipEnd = c.offset + (c.end - c.start) / c.speed;
    return currentTime >= c.offset && currentTime < clipEnd;
  });

  const activeMedia = activeMediaId ? mediaFiles.find((f) => f.id === activeMediaId) : null;

  const previewSource = hasTimelineClips
    ? (activeClip?.sourcePath || null)
    : (activeMedia?.path || null);

  const previewType = hasTimelineClips
    ? (activeClip?.type || null)
    : (activeMedia?.type || null);

  const isImage = previewType === 'image';
  const showVideo = !!previewSource && !isImage;

  const activeTrack = activeClip ? tracks[activeClip.track] : null;
  const trackMuted = activeTrack?.muted ?? false;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!previewSource || isImage) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      lastSourceRef.current = null;
      return;
    }

    if (lastSourceRef.current !== previewSource) {
      video.pause();
      video.src = previewSource;
      lastSourceRef.current = previewSource;

      video.onloadeddata = () => {
        if (activeClip) {
          const sourceTime = activeClip.start + (currentTime - activeClip.offset) * activeClip.speed;
          video.currentTime = sourceTime;
          video.volume = computeEffectiveVolume(activeClip, currentTime, trackMuted);
        }
        if (useEditorStore.getState().isPlaying) video.play().catch(() => {});
      };

      video.onerror = () => {
        console.warn('Video could not be loaded:', previewSource);
      };
      return;
    }

    if (activeClip) {
      const sourceTime = activeClip.start + (currentTime - activeClip.offset) * activeClip.speed;
      if (Math.abs(video.currentTime - sourceTime) > 0.15) {
        video.currentTime = sourceTime;
      }
      video.playbackRate = activeClip.speed;
      video.volume = computeEffectiveVolume(activeClip, currentTime, trackMuted);
    }
  }, [previewSource, currentTime, activeClip, isImage, trackMuted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && previewSource && !isImage) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, previewSource, isImage]);

  const togglePlay = useCallback(() => {
    if (duration === 0 && clips.length === 0 && !activeMedia) return;
    setIsPlaying(!isPlaying);
  }, [isPlaying, duration, clips.length, activeMedia, setIsPlaying]);

  const skipBack = useCallback(() => {
    setCurrentTime(Math.max(0, currentTime - 5));
  }, [currentTime, setCurrentTime]);

  const skipForward = useCallback(() => {
    setCurrentTime(currentTime + 5);
  }, [currentTime, setCurrentTime]);

  const goToStart = useCallback(() => {
    setCurrentTime(0);
  }, [setCurrentTime]);

  const goToEnd = useCallback(() => {
    if (duration > 0) setCurrentTime(duration);
  }, [duration, setCurrentTime]);

  const noClipMessage = hasTimelineClips && !activeClip
    ? 'No clip at current time'
    : null;

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Preview</h2>
        <span className="text-xs text-gray-500 font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center bg-black relative overflow-hidden">
        {/* Video element is always mounted to avoid stale source tracking */}
        <video
          ref={videoRef}
          className={`max-w-full max-h-full ${showVideo ? '' : 'hidden'}`}
          playsInline
        />

        {isImage && previewSource ? (
          <img
            src={previewSource}
            alt="Preview"
            className="max-w-full max-h-full object-contain"
          />
        ) : !previewSource && noClipMessage ? (
          <div className="text-center text-gray-600">
            <svg className="w-12 h-12 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-xs">{noClipMessage}</p>
          </div>
        ) : !previewSource ? (
          <div className="text-center text-gray-600">
            <svg className="w-16 h-16 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">Import media and add to timeline</p>
            <p className="text-xs text-gray-700 mt-1">Supports MP4, MOV, AVI, MKV, HEVC, 3GP, HEIC, and more</p>
          </div>
        ) : null}
      </div>

      <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-800">
        <div className="flex items-center justify-center gap-2">
          <PlayerButton onClick={goToStart} title="Go to start">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
          </PlayerButton>
          <PlayerButton onClick={skipBack} title="Back 5s">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" /></svg>
          </PlayerButton>
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition-colors"
          >
            {isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
            ) : (
              <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <PlayerButton onClick={skipForward} title="Forward 5s">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" /></svg>
          </PlayerButton>
          <PlayerButton onClick={goToEnd} title="Go to end">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          </PlayerButton>
        </div>
      </div>
    </div>
  );
};

const PlayerButton: React.FC<{
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
  >
    {children}
  </button>
);
