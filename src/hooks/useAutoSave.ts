import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { AUTOSAVE_INTERVAL } from '../utils/projectTypes';

export function useAutoSave(): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      const state = useEditorStore.getState();

      if (!state.isDirty) return;
      if (state.isSaving) return;
      if (state.isExporting) return;
      if (state.showDashboard) return;

      const hasContent =
        state.clips.length > 0 ||
        state.textOverlays.length > 0 ||
        state.imageOverlays.length > 0;

      if (!hasContent) return;

      if (state.projectId) {
        console.log('[AutoSave] Saving project...');
        state.saveCurrentProject().catch((err) => {
          console.warn('[AutoSave] Failed:', err);
        });
      }
    }, AUTOSAVE_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);
}
