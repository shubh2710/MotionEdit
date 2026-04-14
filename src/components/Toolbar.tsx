import React, { useState, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { ExportModal } from './ExportModal';
import { BlankClipModal } from './BlankClipModal';
import { TransitionPicker } from './TransitionPicker';
import { SaveProjectModal } from './SaveProjectModal';

export const Toolbar: React.FC = () => {
  const {
    selectedClipIds, splitAtPlayhead, removeSelectedClips, undo, redo,
    zoom, setZoom, clips, currentTime,
    addTextOverlay, addImageOverlay, selectOverlay,
    projectName, isDirty, isSaving, setShowDashboard, newProject,
    saveCurrentProject, projectId,
  } = useEditorStore();

  const [showExport, setShowExport] = useState(false);
  const [showBlankClip, setShowBlankClip] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [showSave, setShowSave] = useState<'save' | 'saveAs' | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const hasSelection = selectedClipIds.length > 0;
  const hasClipUnderPlayhead = clips.some((c) => {
    const clipEnd = c.offset + (c.end - c.start) / c.speed;
    return currentTime > c.offset && currentTime < clipEnd;
  });

  const handleAddText = () => {
    const id = addTextOverlay();
    selectOverlay(id, 'text');
  };

  const handleAddImage = () => {
    imageInputRef.current?.click();
  };

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        const id = addImageOverlay(url, file.name, file);
        selectOverlay(id, 'image');
      }
    }
    e.target.value = '';
  };

  const handleQuickSave = async () => {
    if (projectId) {
      await saveCurrentProject();
    } else {
      setShowSave('save');
    }
  };

  return (
    <>
      <div className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-1">
          {/* Project buttons */}
          <ToolButton
            icon={<HomeIcon />} label="Projects" onClick={() => setShowDashboard(true)}
          />
          <ToolButton
            icon={<NewIcon />} label="New Project" onClick={newProject}
          />
          <ToolButton
            icon={<SaveIcon />} label="Save" shortcut="Ctrl+S" onClick={handleQuickSave}
          />
          <ToolButton
            icon={<SaveAsIcon />} label="Save As" onClick={() => setShowSave('saveAs')}
          />

          <Divider />

          <ToolButton icon={<UndoIcon />} label="Undo" shortcut="Ctrl+Z" onClick={undo} />
          <ToolButton icon={<RedoIcon />} label="Redo" shortcut="Ctrl+Y" onClick={redo} />

          <Divider />

          <ToolButtonLabeled icon={<SplitIcon />} label="Split" shortcut="Ctrl+B"
            onClick={splitAtPlayhead} disabled={!hasClipUnderPlayhead} />
          <ToolButtonLabeled icon={<DeleteIcon />} label="Delete" shortcut="Del"
            onClick={removeSelectedClips} disabled={!hasSelection} danger />

          <Divider />

          <ToolButtonLabeled icon={<TextIcon />} label="Text" onClick={handleAddText} accent="amber" />
          <ToolButtonLabeled icon={<ImageIcon />} label="Image" onClick={handleAddImage} accent="pink" />
          <ToolButtonLabeled icon={<BlankIcon />} label="Blank" onClick={() => setShowBlankClip(true)} accent="gray" />
          <ToolButtonLabeled icon={<TransitionIcon />} label="Transition" onClick={() => setShowTransition(true)} accent="yellow" />

          <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageFile} />
        </div>

        <div className="flex items-center gap-3">
          {/* Project name & status */}
          <div className="flex items-center gap-2 mr-2">
            <span className="text-xs text-gray-400 truncate max-w-[160px]">
              {projectName}
            </span>
            {isDirty && (
              <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" title="Unsaved changes" />
            )}
            {isSaving && (
              <svg className="w-3.5 h-3.5 animate-spin text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>

          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5">
            <button onClick={() => setZoom(zoom - 2)} className="text-gray-400 hover:text-white transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M20 12H4" /></svg>
            </button>
            <input type="range" min={1} max={50} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))} className="w-24 h-1 accent-blue-500" />
            <button onClick={() => setZoom(zoom + 2)} className="text-gray-400 hover:text-white transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
            </button>
            <span className="text-xs text-gray-400 w-8 text-center">{zoom}x</span>
          </div>

          <button onClick={() => setShowExport(true)}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
        </div>
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {showBlankClip && <BlankClipModal onClose={() => setShowBlankClip(false)} />}
      {showTransition && <TransitionPicker onClose={() => setShowTransition(false)} />}
      {showSave && <SaveProjectModal mode={showSave} onClose={() => setShowSave(null)} />}
    </>
  );
};

const Divider = () => <div className="w-px h-6 bg-gray-700 mx-2" />;

const ToolButton: React.FC<{
  icon: React.ReactNode; label: string; shortcut?: string;
  onClick: () => void; disabled?: boolean;
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
  icon: React.ReactNode; label: string; shortcut?: string;
  onClick: () => void; disabled?: boolean; danger?: boolean; accent?: string;
}> = ({ icon, label, shortcut, onClick, disabled, danger, accent }) => (
  <button
    title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
    onClick={onClick}
    disabled={disabled}
    className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors
      ${disabled
        ? 'text-gray-600 cursor-not-allowed'
        : danger
          ? 'text-gray-300 hover:text-red-400 hover:bg-red-900/30'
          : accent
            ? `text-gray-300 hover:text-${accent}-400 hover:bg-${accent}-900/30`
            : 'text-gray-300 hover:text-white hover:bg-gray-800'}`}
  >
    {icon}
    {label}
  </button>
);

// Icons
const HomeIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);
const NewIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);
const SaveIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
  </svg>
);
const SaveAsIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16v2a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2h2m3-4H9.5a2 2 0 00-2 2v7a2 2 0 002 2h9a2 2 0 002-2V7.414a1 1 0 00-.293-.707l-3.414-3.414A1 1 0 0013.586 3H12" />
  </svg>
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
const TextIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 6v2m16-2v2M7 6v12m5-12v12m5-12v12M7 18h10" />
  </svg>
);
const ImageIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);
const BlankIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4h16v16H4V4z" />
  </svg>
);
const TransitionIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4-4m-4 4l4 4" />
  </svg>
);
