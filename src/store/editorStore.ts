import { create } from 'zustand';
import { Clip, MediaFile, Track, ExportSettings, HistoryAction } from '../utils/types';
import { generateId } from '../utils/helpers';

interface EditorState {
  mediaFiles: MediaFile[];
  clips: Clip[];
  tracks: Track[];
  selectedClipIds: string[];
  currentTime: number;
  isPlaying: boolean;
  duration: number;
  zoom: number;
  activeMediaId: string | null;
  exportSettings: ExportSettings;
  isExporting: boolean;
  exportProgress: number;
  history: HistoryAction[];
  historyIndex: number;

  addMediaFiles: (files: MediaFile[]) => void;
  removeMediaFile: (id: string) => void;
  updateMediaFile: (id: string, updates: Partial<MediaFile>) => void;
  addClipToTimeline: (clip: Omit<Clip, 'id'>) => string;
  updateClip: (id: string, updates: Partial<Clip>) => void;
  removeClip: (id: string) => void;
  removeSelectedClips: () => void;
  splitClipAtPlayhead: (clipId: string) => void;
  splitAtPlayhead: () => void;
  selectClip: (id: string, multi?: boolean) => void;
  clearSelection: () => void;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  setActiveMedia: (id: string | null) => void;
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  setIsExporting: (exporting: boolean) => void;
  setExportProgress: (progress: number) => void;
  addTrack: (type: 'video' | 'audio') => void;
  toggleTrackMute: (id: string) => void;
  toggleTrackLock: (id: string) => void;
  recalculateDuration: () => void;
  pushHistory: (action: HistoryAction) => void;
  undo: () => void;
  redo: () => void;
}

const DEFAULT_TRACKS: Track[] = [
  { id: 'video-1', name: 'Video 1', type: 'video', muted: false, locked: false },
  { id: 'video-2', name: 'Video 2', type: 'video', muted: false, locked: false },
  { id: 'audio-1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
];

export const useEditorStore = create<EditorState>((set, get) => ({
  mediaFiles: [],
  clips: [],
  tracks: DEFAULT_TRACKS,
  selectedClipIds: [],
  currentTime: 0,
  isPlaying: false,
  duration: 0,
  zoom: 5,
  activeMediaId: null,
  exportSettings: {
    format: 'mp4',
    resolution: '1920x1080',
    fps: 30,
    quality: 'high',
  },
  isExporting: false,
  exportProgress: 0,
  history: [],
  historyIndex: -1,

  addMediaFiles: (files) =>
    set((state) => ({
      mediaFiles: [...state.mediaFiles, ...files],
    })),

  removeMediaFile: (id) =>
    set((state) => ({
      mediaFiles: state.mediaFiles.filter((f) => f.id !== id),
    })),

  updateMediaFile: (id, updates) =>
    set((state) => ({
      mediaFiles: state.mediaFiles.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    })),

  addClipToTimeline: (clipData) => {
    const id = generateId();
    const clip: Clip = { ...clipData, id };
    set((state) => {
      const newClips = [...state.clips, clip];
      return { clips: newClips };
    });
    get().recalculateDuration();
    return id;
  },

  updateClip: (id, updates) =>
    set((state) => ({
      clips: state.clips.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),

  removeClip: (id) => {
    set((state) => ({
      clips: state.clips.filter((c) => c.id !== id),
      selectedClipIds: state.selectedClipIds.filter((sid) => sid !== id),
    }));
    get().recalculateDuration();
  },

  removeSelectedClips: () => {
    const { selectedClipIds, clips } = get();
    if (selectedClipIds.length === 0) return;
    const removedClips = clips.filter((c) => selectedClipIds.includes(c.id));
    set((state) => ({
      clips: state.clips.filter((c) => !selectedClipIds.includes(c.id)),
      selectedClipIds: [],
    }));
    get().pushHistory({
      type: 'removeClips',
      undo: () => set((state) => ({ clips: [...state.clips, ...removedClips] })),
      redo: () =>
        set((state) => ({
          clips: state.clips.filter((c) => !removedClips.some((r) => r.id === c.id)),
        })),
    });
    get().recalculateDuration();
  },

  splitClipAtPlayhead: (clipId) => {
    const { clips, currentTime } = get();
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;

    const clipStart = clip.offset;
    const clipEnd = clip.offset + (clip.end - clip.start) / clip.speed;
    if (currentTime <= clipStart || currentTime >= clipEnd) return;

    const splitPointInSource = clip.start + (currentTime - clip.offset) * clip.speed;
    const leftClip: Clip = { ...clip, end: splitPointInSource, fadeOut: 0 };
    const rightClip: Clip = {
      ...clip,
      id: generateId(),
      start: splitPointInSource,
      offset: currentTime,
      fadeIn: 0,
    };

    set((state) => ({
      clips: state.clips.map((c) => (c.id === clipId ? leftClip : c)).concat(rightClip),
    }));

    get().pushHistory({
      type: 'splitClip',
      undo: () =>
        set((state) => ({
          clips: state.clips
            .filter((c) => c.id !== rightClip.id)
            .map((c) => (c.id === clipId ? clip : c)),
        })),
      redo: () =>
        set((state) => ({
          clips: state.clips.map((c) => (c.id === clipId ? leftClip : c)).concat(rightClip),
        })),
    });
  },

  splitAtPlayhead: () => {
    const { clips, currentTime } = get();
    const clipUnderPlayhead = clips.find((c) => {
      const clipEnd = c.offset + (c.end - c.start) / c.speed;
      return currentTime > c.offset && currentTime < clipEnd;
    });
    if (clipUnderPlayhead) {
      get().splitClipAtPlayhead(clipUnderPlayhead.id);
    }
  },

  selectClip: (id, multi = false) =>
    set((state) => {
      if (multi) {
        const isSelected = state.selectedClipIds.includes(id);
        return {
          selectedClipIds: isSelected
            ? state.selectedClipIds.filter((sid) => sid !== id)
            : [...state.selectedClipIds, id],
        };
      }
      return { selectedClipIds: [id] };
    }),

  clearSelection: () => set({ selectedClipIds: [] }),

  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setZoom: (zoom) => set({ zoom: Math.max(1, Math.min(50, zoom)) }),
  setActiveMedia: (id) => set({ activeMediaId: id }),

  setExportSettings: (settings) =>
    set((state) => ({
      exportSettings: { ...state.exportSettings, ...settings },
    })),

  setIsExporting: (exporting) => set({ isExporting: exporting }),
  setExportProgress: (progress) => set({ exportProgress: progress }),

  addTrack: (type) =>
    set((state) => {
      const count = state.tracks.filter((t) => t.type === type).length + 1;
      const newTrack: Track = {
        id: generateId(),
        name: `${type === 'video' ? 'Video' : 'Audio'} ${count}`,
        type,
        muted: false,
        locked: false,
      };
      return { tracks: [...state.tracks, newTrack] };
    }),

  toggleTrackMute: (id) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t)),
    })),

  toggleTrackLock: (id) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, locked: !t.locked } : t)),
    })),

  recalculateDuration: () => {
    const { clips } = get();
    if (clips.length === 0) {
      set({ duration: 0 });
      return;
    }
    const maxEnd = Math.max(...clips.map((c) => c.offset + (c.end - c.start) / c.speed));
    set({ duration: maxEnd });
  },

  pushHistory: (action) =>
    set((state) => {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(action);
      return { history: newHistory, historyIndex: newHistory.length - 1 };
    }),

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < 0) return;
    history[historyIndex].undo();
    set({ historyIndex: historyIndex - 1 });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    history[historyIndex + 1].redo();
    set({ historyIndex: historyIndex + 1 });
  },
}));
