import React, { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { MediaLibrary } from './features/media/MediaLibrary';
import { VideoPlayer } from './features/player/VideoPlayer';
import { Timeline } from './features/timeline/Timeline';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ProjectDashboard } from './components/ProjectDashboard';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { usePlaybackEngine } from './hooks/usePlaybackEngine';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useAutoSave } from './hooks/useAutoSave';
import { useEditorStore } from './store/editorStore';

const App: React.FC = () => {
  useKeyboardShortcuts();
  usePlaybackEngine();
  useAudioEngine();
  useAutoSave();

  const showDashboard = useEditorStore((s) => s.showDashboard);
  const isDirty = useEditorStore((s) => s.isDirty);

  const [leftPanelWidth, setLeftPanelWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(240);
  const [timelineHeight, setTimelineHeight] = useState(280);

  // Ctrl+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const state = useEditorStore.getState();
        if (state.projectId) {
          state.saveCurrentProject().catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Warn before unload if dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (showDashboard) {
    return <ProjectDashboard />;
  }

  const handleHorizontalResize = (
    setter: React.Dispatch<React.SetStateAction<number>>,
    startWidth: number,
    direction: 1 | -1
  ) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const onMove = (me: MouseEvent) => {
      const delta = (me.clientX - startX) * direction;
      setter(Math.max(180, Math.min(500, startWidth + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleVerticalResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = timelineHeight;
    const onMove = (me: MouseEvent) => {
      const delta = startY - me.clientY;
      setTimelineHeight(Math.max(150, Math.min(600, startHeight + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      <TitleBar />
      <Toolbar />

      <div className="flex-1 flex overflow-hidden">
        <div className="border-r border-gray-800 bg-gray-900/50 overflow-hidden" style={{ width: leftPanelWidth }}>
          <MediaLibrary />
        </div>

        <div
          className="w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors flex-shrink-0"
          onMouseDown={handleHorizontalResize(setLeftPanelWidth, leftPanelWidth, 1)}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <VideoPlayer />
          </div>
        </div>

        <div
          className="w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors flex-shrink-0"
          onMouseDown={handleHorizontalResize(setRightPanelWidth, rightPanelWidth, -1)}
        />

        <div className="border-l border-gray-800 bg-gray-900/50 overflow-hidden" style={{ width: rightPanelWidth }}>
          <PropertiesPanel />
        </div>
      </div>

      <div
        className="h-1 cursor-row-resize hover:bg-blue-500/50 transition-colors flex-shrink-0"
        onMouseDown={handleVerticalResize}
      />

      <div className="border-t border-gray-800 overflow-hidden" style={{ height: timelineHeight }}>
        <Timeline />
      </div>
    </div>
  );
};

export default App;
