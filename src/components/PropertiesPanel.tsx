import React from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTime } from '../utils/helpers';

export const PropertiesPanel: React.FC = () => {
  const { selectedClipIds, clips, updateClip, removeClip, splitClipAtPlayhead, currentTime, removeSelectedClips } = useEditorStore();

  if (selectedClipIds.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-gray-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Properties</h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm p-4 text-center">
          <div>
            <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
            <p className="text-xs">Click a clip in the timeline to see its properties</p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedClipIds.length > 1) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-gray-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Properties</h2>
        </div>
        <div className="flex-1 p-3 space-y-3">
          <p className="text-sm text-gray-400">{selectedClipIds.length} clips selected</p>
          <button
            onClick={removeSelectedClips}
            className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete {selectedClipIds.length} clips
          </button>
        </div>
      </div>
    );
  }

  const clip = clips.find((c) => c.id === selectedClipIds[0]);
  if (!clip) return null;

  const clipDuration = (clip.end - clip.start) / clip.speed;
  const clipTimeEnd = clip.offset + clipDuration;
  const playheadIsOnClip = currentTime > clip.offset && currentTime < clipTimeEnd;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Properties</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Clip info */}
        <div>
          <p className="text-sm font-medium text-gray-200 truncate">{clip.sourceName}</p>
          <p className="text-xs text-gray-500 capitalize">{clip.type}</p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => splitClipAtPlayhead(clip.id)}
            disabled={!playheadIsOnClip}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5
              ${playheadIsOnClip
                ? 'bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400'
                : 'bg-gray-800/50 text-gray-600 cursor-not-allowed'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16M8 8l-4 4 4 4M16 8l4 4-4 4" />
            </svg>
            Split
          </button>
          <button
            onClick={() => removeClip(clip.id)}
            className="flex-1 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>

        {/* Time info */}
        <div className="space-y-3">
          <PropertyRow label="Duration" value={formatTime(clipDuration)} />
          <PropertyRow label="Start" value={formatTime(clip.start)} />
          <PropertyRow label="End" value={formatTime(clip.end)} />
          <PropertyRow label="Offset" value={formatTime(clip.offset)} />

          {/* Speed */}
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Speed</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.25}
                value={clip.speed}
                onChange={(e) => updateClip(clip.id, { speed: Number(e.target.value) })}
                className="flex-1 h-1 accent-blue-500"
              />
              <span className="text-xs text-gray-300 w-10 text-right font-mono">{clip.speed}x</span>
            </div>
            <div className="flex justify-between mt-1">
              {[0.25, 0.5, 1, 2, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => updateClip(clip.id, { speed: s })}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors
                    ${clip.speed === s ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* Volume */}
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Volume</label>
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
              </svg>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clip.audioVolume}
                onChange={(e) => updateClip(clip.id, { audioVolume: Number(e.target.value) })}
                className="flex-1 h-1 accent-green-500"
              />
              <span className="text-xs text-gray-300 w-10 text-right font-mono">
                {Math.round(clip.audioVolume * 100)}%
              </span>
            </div>
            <div className="flex justify-between mt-1">
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <button
                  key={v}
                  onClick={() => updateClip(clip.id, { audioVolume: v })}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors
                    ${clip.audioVolume === v ? 'bg-green-600 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
                >
                  {Math.round(v * 100)}%
                </button>
              ))}
            </div>
          </div>

          {/* Fade In */}
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Fade In</label>
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 17l6-6 4 4 8-8" />
              </svg>
              <input
                type="range"
                min={0}
                max={Math.min(5, clipDuration / 2)}
                step={0.1}
                value={clip.fadeIn}
                onChange={(e) => updateClip(clip.id, { fadeIn: Number(e.target.value) })}
                className="flex-1 h-1 accent-cyan-500"
              />
              <span className="text-xs text-gray-300 w-10 text-right font-mono">
                {clip.fadeIn.toFixed(1)}s
              </span>
            </div>
            <div className="flex justify-between mt-1">
              {[0, 0.5, 1, 2, 3].filter((v) => v <= clipDuration / 2).map((v) => (
                <button
                  key={v}
                  onClick={() => updateClip(clip.id, { fadeIn: v })}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors
                    ${clip.fadeIn === v ? 'bg-cyan-600 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
                >
                  {v}s
                </button>
              ))}
            </div>
          </div>

          {/* Fade Out */}
          <div>
            <label className="block text-[11px] text-gray-400 mb-1">Fade Out</label>
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7l6 6 4-4 8 8" />
              </svg>
              <input
                type="range"
                min={0}
                max={Math.min(5, clipDuration / 2)}
                step={0.1}
                value={clip.fadeOut}
                onChange={(e) => updateClip(clip.id, { fadeOut: Number(e.target.value) })}
                className="flex-1 h-1 accent-orange-500"
              />
              <span className="text-xs text-gray-300 w-10 text-right font-mono">
                {clip.fadeOut.toFixed(1)}s
              </span>
            </div>
            <div className="flex justify-between mt-1">
              {[0, 0.5, 1, 2, 3].filter((v) => v <= clipDuration / 2).map((v) => (
                <button
                  key={v}
                  onClick={() => updateClip(clip.id, { fadeOut: v })}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors
                    ${clip.fadeOut === v ? 'bg-orange-600 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
                >
                  {v}s
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const PropertyRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between items-center">
    <span className="text-[11px] text-gray-400">{label}</span>
    <span className="text-xs text-gray-300 font-mono">{value}</span>
  </div>
);
