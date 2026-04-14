import React, { useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { secondsToPixels } from '../../utils/helpers';
import { Transition, TransitionType } from '../../utils/types';

interface Props {
  transition: Transition;
  zoom: number;
  trackIndex: number;
}

const TRANSITION_LABELS: Record<TransitionType, string> = {
  fade: 'Fade',
  crossDissolve: 'Dissolve',
  slideLeft: '← Slide',
  slideRight: 'Slide →',
  slideUp: '↑ Slide',
  slideDown: '↓ Slide',
  zoom: 'Zoom',
  blur: 'Blur',
  wipe: 'Wipe',
};

export const TimelineTransition: React.FC<Props> = ({ transition, zoom, trackIndex }) => {
  const { clips, removeTransition, updateTransition } = useEditorStore();

  const fromClip = clips.find((c) => c.id === transition.fromClipId);
  const toClip = clips.find((c) => c.id === transition.toClipId);
  if (!fromClip || !toClip) return null;

  const fromEnd = fromClip.offset + (fromClip.end - fromClip.start) / fromClip.speed;
  const transitionStart = fromEnd - transition.duration;
  const left = secondsToPixels(transitionStart, zoom);
  const width = secondsToPixels(transition.duration, zoom);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    removeTransition(transition.id);
  }, [transition.id, removeTransition]);

  const cycleType = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const types: TransitionType[] = ['fade', 'crossDissolve', 'slideLeft', 'slideRight', 'zoom', 'blur', 'wipe'];
    const idx = types.indexOf(transition.type);
    const next = types[(idx + 1) % types.length];
    updateTransition(transition.id, { type: next });
  }, [transition, updateTransition]);

  return (
    <div
      data-timeline-clip
      className="absolute top-0 bottom-0 z-[5] cursor-pointer group/tr"
      style={{ left, width: Math.max(width, 8) }}
      onClick={cycleType}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/20 via-yellow-500/40 to-yellow-500/20 border border-yellow-500/50 rounded-sm">
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-[8px] font-bold text-yellow-300 uppercase tracking-wider">
            {TRANSITION_LABELS[transition.type]}
          </span>
        </div>
      </div>
      <button
        onClick={handleDelete}
        className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-white opacity-0 group-hover/tr:opacity-100 transition-opacity flex items-center justify-center"
      >
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};
