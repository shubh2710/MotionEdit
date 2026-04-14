import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { secondsToPixels } from '../../utils/helpers';
import { Clip, TransitionType, Transition } from '../../utils/types';

interface Props {
  fromClip: Clip;
  toClip: Clip;
  existingTransition: Transition | undefined;
  zoom: number;
}

const TRANSITION_OPTIONS: { type: TransitionType; label: string; icon: string }[] = [
  { type: 'fade', label: 'Fade', icon: '◐' },
  { type: 'crossDissolve', label: 'Dissolve', icon: '◑' },
  { type: 'slideLeft', label: '← Slide', icon: '←' },
  { type: 'slideRight', label: 'Slide →', icon: '→' },
  { type: 'slideUp', label: '↑ Slide', icon: '↑' },
  { type: 'slideDown', label: '↓ Slide', icon: '↓' },
  { type: 'zoom', label: 'Zoom', icon: '⊕' },
  { type: 'blur', label: 'Blur', icon: '◌' },
  { type: 'wipe', label: 'Wipe', icon: '▬' },
];

export const AddTransitionButton: React.FC<Props> = ({ fromClip, toClip, existingTransition, zoom }) => {
  const { addTransition, removeTransition, updateTransition } = useEditorStore();
  const [showPicker, setShowPicker] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fromEnd = fromClip.offset + (fromClip.end - fromClip.start) / fromClip.speed;

  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  const handleAdd = useCallback((type: TransitionType) => {
    addTransition({
      type,
      duration: 1,
      fromClipId: fromClip.id,
      toClipId: toClip.id,
    });
    setShowPicker(false);
  }, [fromClip.id, toClip.id, addTransition]);

  const handleRemove = useCallback(() => {
    if (existingTransition) {
      removeTransition(existingTransition.id);
      setShowPicker(false);
    }
  }, [existingTransition, removeTransition]);

  const handleChangeType = useCallback((type: TransitionType) => {
    if (existingTransition) {
      updateTransition(existingTransition.id, { type });
    }
  }, [existingTransition, updateTransition]);

  const handleChangeDuration = useCallback((dur: number) => {
    if (existingTransition) {
      updateTransition(existingTransition.id, { duration: dur });
    }
  }, [existingTransition, updateTransition]);

  if (existingTransition) {
    const trStart = fromEnd - existingTransition.duration;
    const left = secondsToPixels(trStart, zoom);
    const width = secondsToPixels(existingTransition.duration, zoom);

    return (
      <div
        data-timeline-clip
        className="absolute top-0 bottom-0 z-[5] cursor-pointer group/tr"
        style={{ left, width: Math.max(width, 20) }}
      >
        <div
          className="absolute inset-0 bg-gradient-to-r from-yellow-500/20 via-yellow-500/40 to-yellow-500/20 border border-yellow-500/50 rounded-sm flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
        >
          <span className="text-[8px] font-bold text-yellow-300 uppercase tracking-wider">
            {existingTransition.type === 'crossDissolve' ? 'Dissolve' : existingTransition.type}
          </span>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); handleRemove(); }}
          className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-white opacity-0 group-hover/tr:opacity-100 transition-opacity flex items-center justify-center z-10"
        >
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {showPicker && (
          <div
            ref={popoverRef}
            className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 w-64"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] text-gray-400 mb-2 font-medium">Edit Transition</div>
            <div className="grid grid-cols-3 gap-1 mb-3">
              {TRANSITION_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  onClick={() => handleChangeType(opt.type)}
                  className={`h-8 rounded text-[10px] transition-colors flex items-center justify-center gap-1
                    ${existingTransition.type === opt.type
                      ? 'bg-yellow-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">Duration: {existingTransition.duration.toFixed(1)}s</label>
              <input
                type="range" min={0.2} max={3} step={0.1}
                value={existingTransition.duration}
                onChange={(e) => handleChangeDuration(Number(e.target.value))}
                className="w-full accent-yellow-500 h-1"
              />
            </div>
            <button
              onClick={handleRemove}
              className="mt-2 w-full py-1.5 rounded text-[10px] bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
            >
              Remove Transition
            </button>
          </div>
        )}
      </div>
    );
  }

  // No transition exists: show "+" button at the boundary
  const btnLeft = secondsToPixels(fromEnd, zoom) - 10;

  return (
    <div
      data-timeline-clip
      className="absolute top-1 bottom-1 z-[6] flex items-center justify-center"
      style={{ left: btnLeft, width: 20 }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
        className="w-5 h-5 rounded-full bg-gray-800 border border-gray-600 hover:border-yellow-500 hover:bg-yellow-900/40 text-gray-500 hover:text-yellow-400 transition-all flex items-center justify-center text-xs font-bold opacity-0 hover:opacity-100 group-hover:opacity-100"
        style={{ opacity: showPicker ? 1 : undefined }}
        title="Add transition"
      >
        +
      </button>

      {showPicker && (
        <div
          ref={popoverRef}
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 w-64"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[11px] text-gray-400 mb-2 font-medium">Add Transition</div>
          <div className="grid grid-cols-3 gap-1">
            {TRANSITION_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                onClick={() => handleAdd(opt.type)}
                className="h-10 rounded bg-gray-800 hover:bg-yellow-900/40 hover:border-yellow-500 border border-gray-700 text-[10px] text-gray-300 transition-colors flex flex-col items-center justify-center gap-0.5"
              >
                <span className="text-sm">{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
