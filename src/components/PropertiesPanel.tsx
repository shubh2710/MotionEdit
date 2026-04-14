import React from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTime } from '../utils/helpers';
import {
  TextOverlay, ImageOverlay, TextStyle,
  TEXT_PRESETS, DEFAULT_TEXT_STYLE, TextAnimation,
} from '../utils/types';

const FONT_FAMILIES = [
  'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New',
  'Verdana', 'Tahoma', 'Impact', 'Comic Sans MS', 'Trebuchet MS',
];

const ANIMATION_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fadeIn', label: 'Fade In' },
  { value: 'fadeOut', label: 'Fade Out' },
  { value: 'fadeInOut', label: 'Fade In/Out' },
  { value: 'slideIn-left', label: 'Slide In Left' },
  { value: 'slideIn-right', label: 'Slide In Right' },
  { value: 'slideIn-up', label: 'Slide In Up' },
  { value: 'slideIn-down', label: 'Slide In Down' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'scale', label: 'Scale Up' },
];

export const PropertiesPanel: React.FC = () => {
  const {
    selectedClipIds, clips, updateClip, removeClip, splitClipAtPlayhead,
    currentTime, removeSelectedClips,
    selectedOverlayId, selectedOverlayType,
    textOverlays, imageOverlays,
    updateTextOverlay, updateImageOverlay,
    removeTextOverlay, removeImageOverlay,
  } = useEditorStore();

  if (selectedOverlayId && selectedOverlayType === 'text') {
    const overlay = textOverlays.find((t) => t.id === selectedOverlayId);
    if (overlay) return <TextOverlayProperties overlay={overlay} />;
  }

  if (selectedOverlayId && selectedOverlayType === 'image') {
    const overlay = imageOverlays.find((i) => i.id === selectedOverlayId);
    if (overlay) return <ImageOverlayProperties overlay={overlay} />;
  }

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
            <p className="text-xs">Select a clip or overlay to edit</p>
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
            Delete {selectedClipIds.length} clips
          </button>
        </div>
      </div>
    );
  }

  const clip = clips.find((c) => c.id === selectedClipIds[0]);
  if (!clip) return null;

  if (clip.type === 'blank') {
    return <BlankClipProperties clip={clip} />;
  }

  const clipDuration = (clip.end - clip.start) / clip.speed;
  const clipTimeEnd = clip.offset + clipDuration;
  const playheadIsOnClip = currentTime > clip.offset && currentTime < clipTimeEnd;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Properties</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <p className="text-sm font-medium text-gray-200 truncate">{clip.sourceName}</p>
          <p className="text-xs text-gray-500 capitalize">{clip.type}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => splitClipAtPlayhead(clip.id)}
            disabled={!playheadIsOnClip}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5
              ${playheadIsOnClip ? 'bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400' : 'bg-gray-800/50 text-gray-600 cursor-not-allowed'}`}
          >
            Split
          </button>
          <button
            onClick={() => removeClip(clip.id)}
            className="flex-1 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs font-medium transition-colors"
          >
            Delete
          </button>
        </div>

        <div className="space-y-3">
          <PropertyRow label="Duration" value={formatTime(clipDuration)} />
          <PropertyRow label="Start" value={formatTime(clip.start)} />
          <PropertyRow label="End" value={formatTime(clip.end)} />
          <PropertyRow label="Offset" value={formatTime(clip.offset)} />

          <SliderControl label="Speed" min={0.25} max={4} step={0.25} value={clip.speed}
            onChange={(v) => updateClip(clip.id, { speed: v })}
            display={`${clip.speed}x`} accent="blue"
            presets={[0.25, 0.5, 1, 2, 4].map((s) => ({ value: s, label: `${s}x` }))} />

          <SliderControl label="Volume" min={0} max={1} step={0.01} value={clip.audioVolume}
            onChange={(v) => updateClip(clip.id, { audioVolume: v })}
            display={`${Math.round(clip.audioVolume * 100)}%`} accent="green"
            presets={[0, 0.25, 0.5, 0.75, 1].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` }))} />

          <SliderControl label="Fade In" min={0} max={Math.min(5, clipDuration / 2)} step={0.1} value={clip.fadeIn}
            onChange={(v) => updateClip(clip.id, { fadeIn: v })}
            display={`${clip.fadeIn.toFixed(1)}s`} accent="cyan"
            presets={[0, 0.5, 1, 2, 3].filter((v) => v <= clipDuration / 2).map((v) => ({ value: v, label: `${v}s` }))} />

          <SliderControl label="Fade Out" min={0} max={Math.min(5, clipDuration / 2)} step={0.1} value={clip.fadeOut}
            onChange={(v) => updateClip(clip.id, { fadeOut: v })}
            display={`${clip.fadeOut.toFixed(1)}s`} accent="orange"
            presets={[0, 0.5, 1, 2, 3].filter((v) => v <= clipDuration / 2).map((v) => ({ value: v, label: `${v}s` }))} />
        </div>
      </div>
    </div>
  );
};

const BlankClipProperties: React.FC<{ clip: typeof useEditorStore extends () => infer S ? S extends { clips: (infer C)[] } ? C : never : never }> = ({ clip }) => {
  const { updateClip, removeClip } = useEditorStore();
  const duration = (clip.end - clip.start) / clip.speed;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Blank Clip</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div
          className="w-full h-16 rounded-lg border border-gray-700"
          style={{
            background: (clip.blankBackground || '#000').includes(',')
              ? `linear-gradient(135deg, ${clip.blankBackground})`
              : clip.blankBackground || '#000',
          }}
        />

        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Background Color</label>
          <input
            type="text"
            value={clip.blankBackground || '#000000'}
            onChange={(e) => updateClip(clip.id, { blankBackground: e.target.value })}
            className="w-full bg-gray-800 rounded px-2 py-1.5 text-xs border border-gray-700 font-mono"
          />
        </div>

        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Duration</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.5}
              max={30}
              step={0.5}
              value={duration}
              onChange={(e) => updateClip(clip.id, { end: Number(e.target.value) })}
              className="flex-1 accent-blue-500"
            />
            <span className="text-xs text-gray-300 w-10 text-right font-mono">{duration.toFixed(1)}s</span>
          </div>
        </div>

        <button
          onClick={() => removeClip(clip.id)}
          className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs font-medium transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
};

const TextOverlayProperties: React.FC<{ overlay: TextOverlay }> = ({ overlay }) => {
  const { updateTextOverlay, removeTextOverlay } = useEditorStore();
  const update = (u: Partial<TextOverlay>) => updateTextOverlay(overlay.id, u);
  const updateStyle = (s: Partial<TextStyle>) => update({ style: { ...overlay.style, ...s } });

  const setAnimation = (value: string) => {
    let anim: TextAnimation;
    if (value === 'none') anim = { type: 'none' };
    else if (value === 'fadeIn') anim = { type: 'fadeIn', duration: 0.5 };
    else if (value === 'fadeOut') anim = { type: 'fadeOut', duration: 0.5 };
    else if (value === 'fadeInOut') anim = { type: 'fadeInOut', fadeInDuration: 0.5, fadeOutDuration: 0.5 };
    else if (value.startsWith('slideIn-')) anim = { type: 'slideIn', direction: value.split('-')[1] as 'left' | 'right' | 'up' | 'down', duration: 0.5 };
    else if (value === 'typewriter') anim = { type: 'typewriter', speed: 15 };
    else if (value === 'scale') anim = { type: 'scale', from: 0.5, to: 1, duration: 0.5 };
    else anim = { type: 'none' };
    update({ animation: anim });
  };

  const currentAnimValue = (() => {
    if (!overlay.animation || overlay.animation.type === 'none') return 'none';
    if (overlay.animation.type === 'slideIn') return `slideIn-${overlay.animation.direction}`;
    return overlay.animation.type;
  })();

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-400">Text Overlay</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Text</label>
          <textarea
            value={overlay.text}
            onChange={(e) => update({ text: e.target.value })}
            className="w-full bg-gray-800 rounded px-2 py-1.5 text-sm border border-gray-700 resize-none h-16"
            placeholder="Enter text..."
          />
        </div>

        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Preset Styles</label>
          <div className="flex flex-wrap gap-1">
            {Object.entries(TEXT_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => updateStyle({ ...DEFAULT_TEXT_STYLE, ...preset.style })}
                className="px-2 py-1 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Font</label>
          <select
            value={overlay.style.fontFamily}
            onChange={(e) => updateStyle({ fontFamily: e.target.value })}
            className="w-full bg-gray-800 rounded px-2 py-1.5 text-xs border border-gray-700"
          >
            {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <SliderControl label="Font Size" min={12} max={120} step={1} value={overlay.style.fontSize}
          onChange={(v) => updateStyle({ fontSize: v })} display={`${overlay.style.fontSize}px`} accent="amber" />

        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-400">Color</label>
          <input type="color" value={overlay.style.color}
            onChange={(e) => updateStyle({ color: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer bg-transparent border border-gray-700" />
          <div className="flex gap-1 ml-auto">
            <StyleToggle active={overlay.style.bold} onClick={() => updateStyle({ bold: !overlay.style.bold })} label="B" bold />
            <StyleToggle active={overlay.style.italic} onClick={() => updateStyle({ italic: !overlay.style.italic })} label="I" italic />
            <StyleToggle active={overlay.style.underline} onClick={() => updateStyle({ underline: !overlay.style.underline })} label="U" underline />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-400">Align</label>
          <div className="flex gap-1 ml-auto">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                onClick={() => updateStyle({ align: a })}
                className={`w-7 h-6 rounded text-[10px] transition-colors
                  ${overlay.style.align === a ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
              >
                {a[0].toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-400">Stroke</label>
          <input type="color" value={overlay.style.strokeColor}
            onChange={(e) => updateStyle({ strokeColor: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer bg-transparent border border-gray-700" />
          <input type="range" min={0} max={8} step={0.5} value={overlay.style.strokeWidth}
            onChange={(e) => updateStyle({ strokeWidth: Number(e.target.value) })}
            className="flex-1 accent-amber-500" />
          <span className="text-[10px] text-gray-400 w-6 text-right">{overlay.style.strokeWidth}</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-400">Shadow</label>
          <input type="color" value={overlay.style.shadowColor}
            onChange={(e) => updateStyle({ shadowColor: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer bg-transparent border border-gray-700" />
          <input type="range" min={0} max={20} step={1} value={overlay.style.shadowBlur}
            onChange={(e) => updateStyle({ shadowBlur: Number(e.target.value) })}
            className="flex-1 accent-amber-500" />
          <span className="text-[10px] text-gray-400 w-6 text-right">{overlay.style.shadowBlur}</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-400">BG</label>
          <input type="color" value={overlay.style.backgroundColor === 'transparent' ? '#000000' : overlay.style.backgroundColor}
            onChange={(e) => updateStyle({ backgroundColor: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer bg-transparent border border-gray-700" />
          <input type="range" min={0} max={1} step={0.05} value={overlay.style.backgroundOpacity}
            onChange={(e) => updateStyle({ backgroundOpacity: Number(e.target.value) })}
            className="flex-1 accent-amber-500" />
          <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round(overlay.style.backgroundOpacity * 100)}%</span>
        </div>

        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Animation</label>
          <select
            value={currentAnimValue}
            onChange={(e) => setAnimation(e.target.value)}
            className="w-full bg-gray-800 rounded px-2 py-1.5 text-xs border border-gray-700"
          >
            {ANIMATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <PositionInputs
          x={overlay.x} y={overlay.y} width={overlay.width} height={overlay.height}
          onChange={(u) => update(u)}
          accent="amber"
        />

        <SliderControl label="Rotation" min={-180} max={180} step={1} value={overlay.rotation}
          onChange={(v) => update({ rotation: v })} display={`${overlay.rotation}°`} accent="amber" />

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] text-gray-400 mb-1">Layer</label>
            <input type="number" min={0} step={1} value={overlay.layer}
              onChange={(e) => update({ layer: Number(e.target.value) })}
              className="w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700" />
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] text-gray-400 mb-1">Start</label>
            <input type="number" min={0} step={0.1} value={overlay.startTime}
              onChange={(e) => update({ startTime: Math.max(0, Number(e.target.value)) })}
              className="w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700" />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-gray-400 mb-1">End</label>
            <input type="number" min={0} step={0.1} value={overlay.endTime}
              onChange={(e) => update({ endTime: Math.max(overlay.startTime + 0.1, Number(e.target.value)) })}
              className="w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700" />
          </div>
        </div>

        <button
          onClick={() => removeTextOverlay(overlay.id)}
          className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs font-medium transition-colors"
        >
          Delete Text Overlay
        </button>
      </div>
    </div>
  );
};

const ImageOverlayProperties: React.FC<{ overlay: ImageOverlay }> = ({ overlay }) => {
  const { updateImageOverlay, removeImageOverlay } = useEditorStore();
  const update = (u: Partial<ImageOverlay>) => updateImageOverlay(overlay.id, u);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-pink-400">Image Overlay</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="flex items-center gap-3">
          <img src={overlay.src} alt={overlay.name} className="w-12 h-12 rounded object-cover border border-gray-700" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200 truncate">{overlay.name}</p>
            <p className="text-[10px] text-gray-500">
              {(overlay.width * 100).toFixed(0)}% x {(overlay.height * 100).toFixed(0)}%
            </p>
          </div>
        </div>

        <SliderControl label="Opacity" min={0} max={1} step={0.05} value={overlay.opacity}
          onChange={(v) => update({ opacity: v })} display={`${Math.round(overlay.opacity * 100)}%`} accent="pink" />

        <PositionInputs
          x={overlay.x} y={overlay.y} width={overlay.width} height={overlay.height}
          onChange={(u) => update(u)}
          accent="pink"
        />

        <SliderControl label="Rotation" min={-180} max={180} step={1} value={overlay.rotation}
          onChange={(v) => update({ rotation: v })} display={`${overlay.rotation}°`} accent="pink" />

        <div className="flex items-center gap-2">
          <input type="checkbox" checked={overlay.maintainAspectRatio}
            onChange={(e) => update({ maintainAspectRatio: e.target.checked })}
            className="accent-pink-500" />
          <label className="text-[11px] text-gray-400">Maintain aspect ratio</label>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] text-gray-400 mb-1">Start</label>
            <input type="number" min={0} step={0.1} value={overlay.startTime}
              onChange={(e) => update({ startTime: Math.max(0, Number(e.target.value)) })}
              className="w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700" />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-gray-400 mb-1">End</label>
            <input type="number" min={0} step={0.1} value={overlay.endTime}
              onChange={(e) => update({ endTime: Math.max(overlay.startTime + 0.1, Number(e.target.value)) })}
              className="w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700" />
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] text-gray-400 mb-1">Layer</label>
            <input type="number" min={0} step={1} value={overlay.layer}
              onChange={(e) => update({ layer: Number(e.target.value) })}
              className="w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700" />
          </div>
        </div>

        <button
          onClick={() => removeImageOverlay(overlay.id)}
          className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs font-medium transition-colors"
        >
          Delete Image Overlay
        </button>
      </div>
    </div>
  );
};

// Reusable components

const PropertyRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between items-center">
    <span className="text-[11px] text-gray-400">{label}</span>
    <span className="text-xs text-gray-300 font-mono">{value}</span>
  </div>
);

const SliderControl: React.FC<{
  label: string; min: number; max: number; step: number; value: number;
  onChange: (v: number) => void; display: string; accent: string;
  presets?: { value: number; label: string }[];
}> = ({ label, min, max, step, value, onChange, display, accent, presets }) => (
  <div>
    <label className="block text-[11px] text-gray-400 mb-1">{label}</label>
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`flex-1 h-1 accent-${accent}-500`} />
      <span className="text-xs text-gray-300 w-12 text-right font-mono">{display}</span>
    </div>
    {presets && presets.length > 0 && (
      <div className="flex justify-between mt-1">
        {presets.map((p) => (
          <button key={p.label}
            onClick={() => onChange(p.value)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors
              ${value === p.value ? `bg-${accent}-600 text-white` : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
    )}
  </div>
);

const StyleToggle: React.FC<{
  active: boolean; onClick: () => void; label: string;
  bold?: boolean; italic?: boolean; underline?: boolean;
}> = ({ active, onClick, label, bold, italic, underline }) => (
  <button
    onClick={onClick}
    className={`w-7 h-6 rounded text-xs transition-colors
      ${active ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}
      ${bold ? 'font-bold' : ''} ${italic ? 'italic' : ''} ${underline ? 'underline' : ''}`}
  >
    {label}
  </button>
);

const PositionInputs: React.FC<{
  x: number; y: number; width: number; height: number;
  onChange: (u: { x?: number; y?: number; width?: number; height?: number }) => void;
  accent: string;
}> = ({ x, y, width, height, onChange, accent }) => {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const pctToNorm = (pct: number) => clamp01(pct / 100);
  const normToPct = (n: number) => Math.round(n * 100);

  return (
    <div className="space-y-2">
      <label className="block text-[11px] text-gray-400">Position & Size</label>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">X (%)</label>
          <input
            type="number" min={0} max={100} step={1}
            value={normToPct(x)}
            onChange={(e) => onChange({ x: pctToNorm(Number(e.target.value)) })}
            className={`w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700 focus:border-${accent}-500 focus:outline-none font-mono`}
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Y (%)</label>
          <input
            type="number" min={0} max={100} step={1}
            value={normToPct(y)}
            onChange={(e) => onChange({ y: pctToNorm(Number(e.target.value)) })}
            className={`w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700 focus:border-${accent}-500 focus:outline-none font-mono`}
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">W (%)</label>
          <input
            type="number" min={3} max={100} step={1}
            value={normToPct(width)}
            onChange={(e) => onChange({ width: Math.max(0.03, pctToNorm(Number(e.target.value))) })}
            className={`w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700 focus:border-${accent}-500 focus:outline-none font-mono`}
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">H (%)</label>
          <input
            type="number" min={3} max={100} step={1}
            value={normToPct(height)}
            onChange={(e) => onChange({ height: Math.max(0.03, pctToNorm(Number(e.target.value))) })}
            className={`w-full bg-gray-800 rounded px-2 py-1 text-xs border border-gray-700 focus:border-${accent}-500 focus:outline-none font-mono`}
          />
        </div>
      </div>
      <div className="flex gap-1 flex-wrap">
        <button onClick={() => onChange({ x: 0.5, y: 0.5 })}
          className="px-2 py-0.5 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700">
          Center
        </button>
        <button onClick={() => onChange({ x: 0.5, y: 0.15 })}
          className="px-2 py-0.5 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700">
          Top
        </button>
        <button onClick={() => onChange({ x: 0.5, y: 0.85 })}
          className="px-2 py-0.5 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700">
          Bottom
        </button>
        <button onClick={() => onChange({ x: 0.15, y: 0.5 })}
          className="px-2 py-0.5 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700">
          Left
        </button>
        <button onClick={() => onChange({ x: 0.85, y: 0.5 })}
          className="px-2 py-0.5 rounded text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700">
          Right
        </button>
      </div>
    </div>
  );
};
