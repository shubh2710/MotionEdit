import React, { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { ExportModal } from './ExportModal';

export const Toolbar: React.FC = () => {
  const { selectedClipIds, splitAtPlayhead, removeSelectedClips, undo, redo, zoom, setZoom, clips, currentTime } = useEditorStore();
  const [showExport, setShowExport] = useState(false);

  const hasSelection = selectedClipIds.length > 0;

  const hasClipUnderPlayhead = clips.some((c) => {
    const clipEnd = c.offset + (c.end - c.start) / c.speed;
    return currentTime > c.offset && currentTime < clipEnd;
  });

  return (
    <>
      <div className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-1">
          <ToolButton icon={<UndoIcon />} label="Undo" shortcut="Ctrl+Z" onClick={undo} />
          <ToolButton icon={<RedoIcon />} label="Redo" shortcut="Ctrl+Y" onClick={redo} />

          <div className="w-px h-6 bg-gray-700 mx-2" />

          <ToolButtonLabeled
            icon={<SplitIcon />}
            label="Split"
            shortcut="Ctrl+B"
            onClick={splitAtPlayhead}
            disabled={!hasClipUnderPlayhead}
          />
          <ToolButtonLabeled
            icon={<DeleteIcon />}
            label="Delete"
            shortcut="Del"
            onClick={removeSelectedClips}
            disabled={!hasSelection}
            danger
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5">
            <button
              onClick={() => setZoom(zoom - 2)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M20 12H4" /></svg>
            </button>
            <input
              type="range"
              min={1}
              max={50}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-24 h-1 accent-blue-500"
            />
            <button
              onClick={() => setZoom(zoom + 2)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
            </button>
            <span className="text-xs text-gray-400 w-8 text-center">{zoom}x</span>
          </div>

          <button
            onClick={() => setShowExport(true)}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
        </div>
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </>
  );
};

const ToolButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon, label, shortcut, onClick, disabled }) => (
  <button
    title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
    onClick={onClick}
    disabled={disabled}
    className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors
      ${disabled ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
  >
    {icon}
  </button>
);

const ToolButtonLabeled: React.FC<{
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}> = ({ icon, label, shortcut, onClick, disabled, danger }) => (
  <button
    title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
    onClick={onClick}
    disabled={disabled}
    className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors
      ${disabled
        ? 'text-gray-600 cursor-not-allowed'
        : danger
          ? 'text-gray-300 hover:text-red-400 hover:bg-red-900/30'
          : 'text-gray-300 hover:text-white hover:bg-gray-800'}`}
  >
    {icon}
    {label}
  </button>
);

const UndoIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
  </svg>
);

const RedoIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" />
  </svg>
);

const SplitIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16M8 8l-4 4 4 4M16 8l4 4-4 4" />
  </svg>
);

const DeleteIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
