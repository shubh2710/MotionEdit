import React, { useState } from 'react';
import { useEditorStore } from '../store/editorStore';

const PRESETS = [
  { name: 'Black', value: '#000000' },
  { name: 'White', value: '#ffffff' },
  { name: 'Dark Blue', value: '#0a0a2e' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Sunset', value: '#f97316,#ec4899' },
  { name: 'Ocean', value: '#0ea5e9,#6366f1' },
  { name: 'Forest', value: '#22c55e,#064e3b' },
  { name: 'Purple Haze', value: '#7c3aed,#ec4899' },
  { name: 'Dark Gradient', value: '#1a1a2e,#16213e,#0f3460' },
];

interface Props {
  onClose: () => void;
}

export const BlankClipModal: React.FC<Props> = ({ onClose }) => {
  const { addBlankClip } = useEditorStore();
  const [duration, setDuration] = useState(5);
  const [background, setBackground] = useState('#000000');
  const [customColor, setCustomColor] = useState('#000000');
  const handleAdd = () => {
    addBlankClip(duration, background, 0, 0);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-[420px] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Add Blank Clip</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Duration (seconds)</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={30}
                step={0.5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <input
                type="number"
                min={0.5}
                max={60}
                step={0.5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-16 bg-gray-800 rounded px-2 py-1 text-sm text-center border border-gray-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Background</label>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setBackground(p.value)}
                  className={`h-10 rounded-lg border-2 transition-all flex items-center justify-center text-[10px] font-medium
                    ${background === p.value ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-gray-700 hover:border-gray-500'}`}
                  style={{
                    background: p.value.includes(',')
                      ? `linear-gradient(135deg, ${p.value})`
                      : p.value,
                    color: ['#ffffff', '#f97316,#ec4899'].includes(p.value) ? '#000' : '#fff',
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mt-3">
              <label className="text-xs text-gray-400">Custom:</label>
              <input
                type="color"
                value={customColor}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  setBackground(e.target.value);
                }}
                className="w-8 h-8 rounded cursor-pointer bg-transparent border border-gray-700"
              />
              <input
                type="text"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                className="flex-1 bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700 font-mono"
                placeholder="#000000 or color1,color2"
              />
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
            <p className="text-xs text-gray-400">
              Blank clips are added to the <span className="text-white font-medium">end of Video Track 1</span>.
              They act as intentional spacers — the only way to create gaps between clips.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div
              className="w-16 h-10 rounded border border-gray-700"
              style={{
                background: background.includes(',')
                  ? `linear-gradient(135deg, ${background})`
                  : background,
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="px-6 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 transition-colors"
              >
                Add Blank Clip
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
