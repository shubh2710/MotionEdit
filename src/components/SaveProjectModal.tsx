import React, { useState } from 'react';
import { useEditorStore } from '../store/editorStore';

interface Props {
  mode: 'save' | 'saveAs';
  onClose: () => void;
}

export const SaveProjectModal: React.FC<Props> = ({ mode, onClose }) => {
  const { projectName, projectId, saveCurrentProject, saveProjectAs, isSaving } = useEditorStore();
  const [name, setName] = useState(
    mode === 'saveAs' ? `${projectName} (Copy)` : projectName,
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canQuickSave = mode === 'save' && projectId;

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a project name');
      return;
    }
    setError(null);

    try {
      if (canQuickSave) {
        await saveCurrentProject(name.trim());
      } else if (mode === 'saveAs') {
        await saveProjectAs(name.trim());
      } else {
        await saveCurrentProject(name.trim());
      }
      setSuccess(true);
      setTimeout(onClose, 800);
    } catch (err) {
      setError(`Save failed: ${err}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isSaving) handleSave();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-xl border border-gray-700 w-[420px] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">
            {mode === 'saveAs' ? 'Save Project As' : 'Save Project'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Project Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Video"
              autoFocus
              className="w-full bg-gray-800 rounded-lg px-4 py-2.5 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>

          <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>Only timeline assets are saved (smart saving)</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>Timeline, overlays, and transitions preserved</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>Playhead position and zoom level saved</span>
            </div>
          </div>

          {success && (
            <div className="bg-green-900/20 border border-green-800/40 rounded-lg px-3 py-2 text-xs text-green-300 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              Project saved successfully!
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || success}
              className="px-6 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Save
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
