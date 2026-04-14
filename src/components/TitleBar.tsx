import React from 'react';

const isElectron = typeof window !== 'undefined' && window.electronAPI;

export const TitleBar: React.FC = () => {
  if (!isElectron) return null;

  return (
    <div className="h-8 bg-gray-900 flex items-center justify-between px-3 select-none"
         style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
        </svg>
        <span className="text-xs font-medium text-gray-400">Desktop Video Editor</span>
      </div>
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button onClick={() => window.electronAPI?.minimizeWindow()}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 10 1"><rect width="10" height="1" /></svg>
        </button>
        <button onClick={() => window.electronAPI?.maximizeWindow()}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" strokeWidth="1.5" /></svg>
        </button>
        <button onClick={() => window.electronAPI?.closeWindow()}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-600 text-gray-400 hover:text-white transition-colors">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      </div>
    </div>
  );
};
