import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { computeEffectiveVolume } from '../utils/helpers';
import { Clip } from '../utils/types';

interface ManagedElement {
  element: HTMLVideoElement | HTMLAudioElement;
  clipId: string;
  sourcePath: string;
  ready: boolean;
}

/**
 * Manages hidden media elements for clips that produce audio but are NOT the
 * visually-active clip in the main VideoPlayer. This covers:
 * - Audio clips on any track
 * - Video clips placed on audio tracks (extracts their audio)
 * - Video clips on non-active video tracks that overlap the current time
 *
 * The main VideoPlayer handles its own audio, so we skip the single clip
 * it is currently rendering to avoid double-playback.
 */
export function useAudioEngine() {
  const elementsRef = useRef<Map<string, ManagedElement>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const div = document.createElement('div');
    div.style.display = 'none';
    document.body.appendChild(div);
    containerRef.current = div;
    return () => {
      elementsRef.current.forEach((m) => {
        m.element.pause();
        m.element.removeAttribute('src');
        m.element.load();
      });
      elementsRef.current.clear();
      div.remove();
    };
  }, []);

  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      const { clips, tracks, currentTime, isPlaying } = state;

      const visualClip = findVisualClip(clips, tracks, currentTime);

      const activeAudioClips = clips.filter((c) => {
        if (c.id === visualClip?.id) return false;
        const clipEnd = c.offset + (c.end - c.start) / c.speed;
        if (currentTime < c.offset || currentTime >= clipEnd) return false;
        if (c.type === 'image') return false;
        return true;
      });

      const activeIds = new Set(activeAudioClips.map((c) => c.id));
      const managed = elementsRef.current;

      managed.forEach((m, id) => {
        if (!activeIds.has(id)) {
          m.element.pause();
          m.element.removeAttribute('src');
          m.element.load();
          m.element.remove();
          managed.delete(id);
        }
      });

      for (const clip of activeAudioClips) {
        const track = tracks[clip.track];
        const trackMuted = track?.muted ?? false;
        const vol = computeEffectiveVolume(clip, currentTime, trackMuted);

        let entry = managed.get(clip.id);

        if (!entry || entry.sourcePath !== clip.sourcePath) {
          if (entry) {
            entry.element.pause();
            entry.element.removeAttribute('src');
            entry.element.load();
            entry.element.remove();
          }

          const el = (clip.type === 'audio')
            ? document.createElement('audio')
            : document.createElement('video');

          el.preload = 'auto';
          (el as HTMLVideoElement).playsInline = true;
          if (el instanceof HTMLVideoElement) el.muted = false;
          el.src = clip.sourcePath;

          containerRef.current?.appendChild(el);

          entry = { element: el, clipId: clip.id, sourcePath: clip.sourcePath, ready: false };
          managed.set(clip.id, entry);

          el.onloadeddata = () => {
            const e = managed.get(clip.id);
            if (e) e.ready = true;
            syncElement(el, clip, currentTime, vol, isPlaying);
          };
        }

        if (entry.ready) {
          syncElement(entry.element, clip, currentTime, vol, isPlaying);
        }
      }
    });

    return unsub;
  }, []);
}

function findVisualClip(clips: Clip[], tracks: { type: string }[], currentTime: number): Clip | undefined {
  return clips.find((c) => {
    const clipEnd = c.offset + (c.end - c.start) / c.speed;
    if (currentTime < c.offset || currentTime >= clipEnd) return false;
    const track = tracks[c.track];
    return track?.type === 'video' && (c.type === 'video' || c.type === 'image');
  });
}

function syncElement(
  el: HTMLVideoElement | HTMLAudioElement,
  clip: Clip,
  currentTime: number,
  volume: number,
  isPlaying: boolean,
) {
  const sourceTime = clip.start + (currentTime - clip.offset) * clip.speed;
  el.volume = Math.min(1, Math.max(0, volume));
  el.playbackRate = clip.speed;

  if (Math.abs(el.currentTime - sourceTime) > 0.2) {
    el.currentTime = sourceTime;
  }

  if (isPlaying && el.paused) {
    el.play().catch(() => {});
  } else if (!isPlaying && !el.paused) {
    el.pause();
  }
}
