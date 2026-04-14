import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';

export function usePlaybackEngine() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const duration = useEditorStore((s) => s.duration);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const lastFrameTime = useRef<number>(0);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    lastFrameTime.current = performance.now();

    function tick(now: number) {
      const delta = (now - lastFrameTime.current) / 1000;
      lastFrameTime.current = now;

      const store = useEditorStore.getState();
      const next = store.currentTime + delta;

      if (store.duration > 0 && next >= store.duration) {
        setCurrentTime(store.duration);
        setIsPlaying(false);
        return;
      }

      setCurrentTime(next);
      animationRef.current = requestAnimationFrame(tick);
    }

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, setCurrentTime, setIsPlaying]);
}
