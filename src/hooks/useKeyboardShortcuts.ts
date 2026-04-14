import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';

export function useKeyboardShortcuts() {
  const store = useEditorStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === ' ') {
        e.preventDefault();
        store.setIsPlaying(!store.isPlaying);
      }

      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      }

      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        store.redo();
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.removeSelectedClips();
      }

      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        store.splitAtPlayhead();
      }

      if (e.key === 'Escape') {
        store.clearSelection();
      }

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        store.setZoom(store.zoom + 2);
      }
      if (e.key === '-') {
        e.preventDefault();
        store.setZoom(store.zoom - 2);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });
}
