import React, { useState, useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import { TransitionType, Clip } from '../utils/types';

interface Props {
  onClose: () => void;
}

function clipDuration(c: Clip): number {
  return (c.end - c.start) / c.speed;
}

const TRANSITION_OPTIONS: { type: TransitionType; label: string; icon: string }[] = [
  { type: 'fade', label: 'Fade', icon: '◐' },
  { type: 'crossDissolve', label: 'Cross Dissolve', icon: '◑' },
  { type: 'slideLeft', label: 'Slide Left', icon: '←' },
  { type: 'slideRight', label: 'Slide Right', icon: '→' },
  { type: 'slideUp', label: 'Slide Up', icon: '↑' },
  { type: 'slideDown', label: 'Slide Down', icon: '↓' },
  { type: 'zoom', label: 'Zoom', icon: '⊕' },
  { type: 'blur', label: 'Blur', icon: '◌' },
  { type: 'wipe', label: 'Wipe', icon: '▬' },
];

export const TransitionPicker: React.FC<Props> = ({ onClose }) => {
  const { clips, transitions, addTransition } = useEditorStore();
  const [selectedType, setSelectedType] = useState<TransitionType>('fade');
  const [duration, setDuration] = useState(1);

  const clipPairs = useMemo(() => {
    const pairs: { from: Clip; to: Clip }[] = [];
    const trackMap = new Map<number, Clip[]>();

    for (const c of clips) {
      const arr = trackMap.get(c.track) || [];
      arr.push(c);
      trackMap.set(c.track, arr);
    }

    for (const [, trackClips] of trackMap) {
      const sorted = trackClips.sort((a, b) => a.offset - b.offset);
      for (let i = 0; i < sorted.length - 1; i++) {
        const existing = transitions.find(
          (t) => t.fromClipId === sorted[i].id && t.toClipId === sorted[i + 1].id,
        );
        if (!existing) {
          pairs.push({ from: sorted[i], to: sorted[i + 1] });
        }
      }
    }
    return pairs;
  }, [clips, transitions]);

  const [selectedPair, setSelectedPair] = useState(0);

  const handleAdd = () => {
    const pair = clipPairs[selectedPair];
    if (!pair) return;
    addTransition({
      type: selectedType,
      duration,
      fromClipId: pair.from.id,
      toClipId: pair.to.id,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-[480px] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Add Transition</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-3 mb-4 border border-gray-700/50">
          <p className="text-xs text-gray-400">
            <span className="text-yellow-400 font-medium">Tip:</span> You can also click the <span className="text-yellow-400 font-bold">+</span> button between any two clips on the timeline to add a transition directly.
          </p>
        </div>

        {clipPairs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">No adjacent clip pairs available.</p>
            <p className="text-xs mt-1">Place two clips on the same track. Transitions are added between adjacent clips.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Between Clips</label>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {clipPairs.map((pair, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedPair(i)}
                    className={`w-full px-3 py-2 rounded-lg text-left text-xs transition-colors flex items-center gap-2
                      ${selectedPair === i ? 'bg-blue-600/30 border border-blue-500' : 'bg-gray-800 border border-transparent hover:bg-gray-700'}`}
                  >
                    <span className="truncate flex-1">{pair.from.sourceName}</span>
                    <span className="text-yellow-400">→</span>
                    <span className="truncate flex-1">{pair.to.sourceName}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Transition Type</label>
              <div className="grid grid-cols-3 gap-2">
                {TRANSITION_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    onClick={() => setSelectedType(opt.type)}
                    className={`h-14 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-1
                      ${selectedType === opt.type
                        ? 'border-yellow-500 bg-yellow-600/20'
                        : 'border-gray-700 hover:border-gray-500 bg-gray-800/50'}`}
                  >
                    <span className="text-lg">{opt.icon}</span>
                    <span className="text-[10px] text-gray-300">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Duration (seconds)</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0.2} max={3} step={0.1} value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="flex-1 accent-yellow-500"
                />
                <span className="text-sm font-mono text-gray-300 w-10 text-right">{duration.toFixed(1)}s</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="px-6 py-2 rounded-lg text-sm font-medium bg-yellow-600 hover:bg-yellow-500 transition-colors"
              >
                Add Transition
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
