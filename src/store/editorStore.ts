import { create } from 'zustand';
import {
  Clip, MediaFile, Track, ExportSettings, HistoryAction,
  TextOverlay, ImageOverlay, Transition, DEFAULT_TEXT_STYLE,
} from '../utils/types';
import { generateId } from '../utils/helpers';
import { ProjectData } from '../utils/projectTypes';
import {
  saveProject, saveAssetBlob, loadAssetBlob, loadProject,
  pushRecentProject, getUsedAssetIds,
} from '../utils/projectStorage';

interface EditorState {
  projectId: string | null;
  projectName: string;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  showDashboard: boolean;

  mediaFiles: MediaFile[];
  clips: Clip[];
  tracks: Track[];
  textOverlays: TextOverlay[];
  imageOverlays: ImageOverlay[];
  transitions: Transition[];
  selectedClipIds: string[];
  selectedOverlayId: string | null;
  selectedOverlayType: 'text' | 'image' | null;
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

  // Project actions
  setShowDashboard: (show: boolean) => void;
  newProject: () => void;
  saveCurrentProject: (name?: string) => Promise<string>;
  saveProjectAs: (name: string) => Promise<string>;
  loadProjectById: (projectId: string) => Promise<boolean>;
  markDirty: () => void;

  // Media
  addMediaFiles: (files: MediaFile[]) => void;
  removeMediaFile: (id: string) => void;
  updateMediaFile: (id: string, updates: Partial<MediaFile>) => void;

  // Clips
  addClipToTimeline: (clip: Omit<Clip, 'id'>) => string;
  updateClip: (id: string, updates: Partial<Clip>) => void;
  removeClip: (id: string) => void;
  removeSelectedClips: () => void;
  splitClipAtPlayhead: (clipId: string) => void;
  splitAtPlayhead: () => void;
  addBlankClip: (duration: number, background: string, track: number, offset: number) => string;

  // Text Overlays
  addTextOverlay: (overlay?: Partial<TextOverlay>) => string;
  updateTextOverlay: (id: string, updates: Partial<TextOverlay>) => void;
  removeTextOverlay: (id: string) => void;

  // Image Overlays
  addImageOverlay: (src: string, name: string, file?: File) => string;
  updateImageOverlay: (id: string, updates: Partial<ImageOverlay>) => void;
  removeImageOverlay: (id: string) => void;

  // Transitions
  addTransition: (transition: Omit<Transition, 'id'>) => string;
  updateTransition: (id: string, updates: Partial<Transition>) => void;
  removeTransition: (id: string) => void;

  // Selection
  selectClip: (id: string, multi?: boolean) => void;
  selectOverlay: (id: string, type: 'text' | 'image') => void;
  clearSelection: () => void;

  // Playback / View
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  setActiveMedia: (id: string | null) => void;

  // Export
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  setIsExporting: (exporting: boolean) => void;
  setExportProgress: (progress: number) => void;

  // Tracks
  addTrack: (type: 'video' | 'audio' | 'overlay') => void;
  toggleTrackMute: (id: string) => void;
  toggleTrackLock: (id: string) => void;

  // Utils
  realignTrack: (trackIndex: number) => void;
  realignAllTracks: () => void;
  recalculateDuration: () => void;
  pushHistory: (action: HistoryAction) => void;
  undo: () => void;
  redo: () => void;
}

const DEFAULT_TRACKS: Track[] = [
  { id: 'video-1', name: 'Video 1', type: 'video', muted: false, locked: false },
  { id: 'video-2', name: 'Video 2', type: 'video', muted: false, locked: false },
  { id: 'audio-1', name: 'Audio 1', type: 'audio', muted: false, locked: false },
  { id: 'overlay-1', name: 'Overlay 1', type: 'overlay', muted: false, locked: false },
];

function clipDuration(c: Clip): number {
  return (c.end - c.start) / c.speed;
}

/**
 * Core realignment algorithm for a single track.
 * Sorts clips by offset, removes gaps, and adjusts overlaps for transitions.
 * Returns updated clips array (only clips on that track are modified).
 */
function computeRealignment(
  allClips: Clip[],
  transitions: Transition[],
  trackIndex: number,
): Clip[] {
  const trackClips = allClips
    .filter((c) => c.track === trackIndex)
    .sort((a, b) => a.offset - b.offset);

  if (trackClips.length === 0) return allClips;

  const updated = new Map<string, Partial<Clip>>();

  let cursor = 0;
  updated.set(trackClips[0].id, { offset: 0 });

  for (let i = 0; i < trackClips.length; i++) {
    const c = trackClips[i];
    const currentOffset = i === 0 ? cursor : (updated.get(c.id)?.offset ?? c.offset);
    const cEnd = currentOffset + clipDuration(c);

    if (i < trackClips.length - 1) {
      const next = trackClips[i + 1];

      const tr = transitions.find(
        (t) => t.fromClipId === c.id && t.toClipId === next.id,
      );

      let nextOffset: number;
      if (tr) {
        nextOffset = cEnd - tr.duration;
      } else {
        nextOffset = cEnd;
      }
      updated.set(next.id, { offset: nextOffset });
    }
  }

  return allClips.map((c) => {
    const patch = updated.get(c.id);
    return patch ? { ...c, ...patch } : c;
  });
}

function buildProjectData(state: EditorState, projectId: string, projectName: string, existingCreatedAt?: string): ProjectData {
  const now = new Date().toISOString();
  const usedIds = getUsedAssetIds({ clips: state.clips, imageOverlays: state.imageOverlays });

  const assets = state.mediaFiles
    .filter((f) => usedIds.has(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      size: f.fileSize,
      duration: f.duration,
      width: f.width,
      height: f.height,
      thumbnail: f.thumbnail,
    }));

  return {
    projectId,
    projectName,
    createdAt: existingCreatedAt || now,
    updatedAt: now,
    version: 1,
    clips: state.clips,
    tracks: state.tracks,
    textOverlays: state.textOverlays,
    imageOverlays: state.imageOverlays.map(({ file, ...rest }) => rest),
    transitions: state.transitions,
    exportSettings: state.exportSettings,
    assets,
    viewState: {
      currentTime: state.currentTime,
      zoom: state.zoom,
    },
  };
}

async function persistAssets(projectId: string, mediaFiles: MediaFile[], clips: Clip[], imageOverlays: ImageOverlay[]): Promise<void> {
  const usedIds = getUsedAssetIds({ clips, imageOverlays });

  for (const mf of mediaFiles) {
    if (!usedIds.has(mf.id)) continue;
    if (mf.file) {
      await saveAssetBlob(projectId, mf.id, mf.file);
    } else if (mf.path.startsWith('blob:')) {
      try {
        const resp = await fetch(mf.path);
        const blob = await resp.blob();
        await saveAssetBlob(projectId, mf.id, blob);
      } catch {}
    }
  }

  for (const io of imageOverlays) {
    if (io.file) {
      await saveAssetBlob(projectId, io.id, io.file);
    } else if (io.src.startsWith('blob:')) {
      try {
        const resp = await fetch(io.src);
        const blob = await resp.blob();
        await saveAssetBlob(projectId, io.id, blob);
      } catch {}
    }
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  projectName: 'Untitled Project',
  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  showDashboard: true,

  mediaFiles: [],
  clips: [],
  tracks: DEFAULT_TRACKS,
  textOverlays: [],
  imageOverlays: [],
  transitions: [],
  selectedClipIds: [],
  selectedOverlayId: null,
  selectedOverlayType: null,
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

  // ---- Project ----
  setShowDashboard: (show) => set({ showDashboard: show }),

  newProject: () => {
    set({
      projectId: null,
      projectName: 'Untitled Project',
      isDirty: false,
      isSaving: false,
      lastSavedAt: null,
      showDashboard: false,
      mediaFiles: [],
      clips: [],
      tracks: [...DEFAULT_TRACKS.map((t) => ({ ...t }))],
      textOverlays: [],
      imageOverlays: [],
      transitions: [],
      selectedClipIds: [],
      selectedOverlayId: null,
      selectedOverlayType: null,
      currentTime: 0,
      isPlaying: false,
      duration: 0,
      zoom: 5,
      activeMediaId: null,
      history: [],
      historyIndex: -1,
    });
  },

  saveCurrentProject: async (name?: string) => {
    const state = get();
    const pid = state.projectId || generateId();
    const pname = name || state.projectName;
    set({ isSaving: true });
    try {
      const existing = state.projectId ? await loadProject(pid) : null;
      const data = buildProjectData(state, pid, pname, existing?.createdAt);
      await persistAssets(pid, state.mediaFiles, state.clips, state.imageOverlays);
      await saveProject(data);
      pushRecentProject(pid);
      set({ projectId: pid, projectName: pname, isDirty: false, isSaving: false, lastSavedAt: data.updatedAt });
      return pid;
    } catch (err) {
      console.error('[Project] Save failed:', err);
      set({ isSaving: false });
      throw err;
    }
  },

  saveProjectAs: async (name: string) => {
    const state = get();
    const newId = generateId();
    set({ isSaving: true, projectId: newId, projectName: name });
    try {
      const data = buildProjectData(state, newId, name);
      await persistAssets(newId, state.mediaFiles, state.clips, state.imageOverlays);
      await saveProject(data);
      pushRecentProject(newId);
      set({ isDirty: false, isSaving: false, lastSavedAt: data.updatedAt });
      return newId;
    } catch (err) {
      console.error('[Project] SaveAs failed:', err);
      set({ isSaving: false });
      throw err;
    }
  },

  loadProjectById: async (projectId: string) => {
    try {
      const data = await loadProject(projectId);
      if (!data) return false;

      const mediaFiles: MediaFile[] = [];
      const blobUrls = new Map<string, string>();

      for (const asset of data.assets) {
        const blob = await loadAssetBlob(projectId, asset.id);
        let path = '';
        if (blob) {
          path = URL.createObjectURL(blob);
          blobUrls.set(asset.id, path);
        }
        mediaFiles.push({
          id: asset.id, name: asset.name, path, type: asset.type,
          duration: asset.duration || 0, width: asset.width, height: asset.height,
          thumbnail: asset.thumbnail, fileSize: asset.size,
        });
      }

      const clips = data.clips.map((c) => ({
        ...c,
        sourcePath: blobUrls.get(c.sourceId) || c.sourcePath,
      }));

      const imageOverlays: ImageOverlay[] = data.imageOverlays.map((io) => ({
        ...io,
        src: blobUrls.get(io.id) || io.src,
      }));

      for (const io of imageOverlays) {
        if (!io.src || !io.src.startsWith('blob:')) {
          const blob = await loadAssetBlob(projectId, io.id);
          if (blob) io.src = URL.createObjectURL(blob);
        }
      }

      pushRecentProject(projectId);

      set({
        projectId: data.projectId, projectName: data.projectName,
        isDirty: false, isSaving: false, lastSavedAt: data.updatedAt,
        showDashboard: false, mediaFiles, clips,
        tracks: data.tracks, textOverlays: data.textOverlays, imageOverlays,
        transitions: data.transitions, exportSettings: data.exportSettings,
        currentTime: data.viewState?.currentTime || 0, zoom: data.viewState?.zoom || 5,
        selectedClipIds: [], selectedOverlayId: null, selectedOverlayType: null,
        isPlaying: false, activeMediaId: null, history: [], historyIndex: -1,
      });

      get().recalculateDuration();
      return true;
    } catch (err) {
      console.error('[Project] Load failed:', err);
      return false;
    }
  },

  markDirty: () => { if (!get().isDirty) set({ isDirty: true }); },

  // ---- Media ----
  addMediaFiles: (files) => {
    set((state) => ({ mediaFiles: [...state.mediaFiles, ...files] }));
    get().markDirty();
  },
  removeMediaFile: (id) => {
    set((state) => ({ mediaFiles: state.mediaFiles.filter((f) => f.id !== id) }));
    get().markDirty();
  },
  updateMediaFile: (id, updates) =>
    set((state) => ({
      mediaFiles: state.mediaFiles.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    })),

  // ---- Clips ----
  addClipToTimeline: (clipData) => {
    const id = generateId();
    const clip: Clip = { ...clipData, id };
    set((state) => ({ clips: [...state.clips, clip] }));
    get().realignTrack(clipData.track);
    get().recalculateDuration();
    get().markDirty();
    return id;
  },

  updateClip: (id, updates) => {
    const clip = get().clips.find((c) => c.id === id);
    set((state) => ({
      clips: state.clips.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
    if (clip) {
      const trackIdx = updates.track !== undefined ? updates.track : clip.track;
      get().realignTrack(trackIdx);
      if (updates.track !== undefined && updates.track !== clip.track) {
        get().realignTrack(clip.track);
      }
    }
    get().recalculateDuration();
    get().markDirty();
  },

  removeClip: (id) => {
    const clip = get().clips.find((c) => c.id === id);
    set((state) => ({
      clips: state.clips.filter((c) => c.id !== id),
      selectedClipIds: state.selectedClipIds.filter((sid) => sid !== id),
      transitions: state.transitions.filter(
        (t) => t.fromClipId !== id && t.toClipId !== id,
      ),
    }));
    if (clip) get().realignTrack(clip.track);
    get().recalculateDuration();
    get().markDirty();
  },

  removeSelectedClips: () => {
    const { selectedClipIds, clips } = get();
    if (selectedClipIds.length === 0) return;
    const removedClips = clips.filter((c) => selectedClipIds.includes(c.id));
    const affectedTracks = new Set(removedClips.map((c) => c.track));

    set((state) => ({
      clips: state.clips.filter((c) => !selectedClipIds.includes(c.id)),
      selectedClipIds: [],
      transitions: state.transitions.filter(
        (t) => !selectedClipIds.includes(t.fromClipId) && !selectedClipIds.includes(t.toClipId),
      ),
    }));

    for (const t of affectedTracks) get().realignTrack(t);

    get().pushHistory({
      type: 'removeClips',
      undo: () => {
        set((state) => ({ clips: [...state.clips, ...removedClips] }));
        for (const t of affectedTracks) get().realignTrack(t);
      },
      redo: () => {
        set((state) => ({
          clips: state.clips.filter((c) => !removedClips.some((r) => r.id === c.id)),
        }));
        for (const t of affectedTracks) get().realignTrack(t);
      },
    });
    get().recalculateDuration();
    get().markDirty();
  },

  splitClipAtPlayhead: (clipId) => {
    const { clips, currentTime } = get();
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;

    const clipStart = clip.offset;
    const clipEnd = clip.offset + clipDuration(clip);
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

    get().realignTrack(clip.track);

    get().pushHistory({
      type: 'splitClip',
      undo: () => {
        set((state) => ({
          clips: state.clips
            .filter((c) => c.id !== rightClip.id)
            .map((c) => (c.id === clipId ? clip : c)),
        }));
        get().realignTrack(clip.track);
      },
      redo: () => {
        set((state) => ({
          clips: state.clips.map((c) => (c.id === clipId ? leftClip : c)).concat(rightClip),
        }));
        get().realignTrack(clip.track);
      },
    });
    get().markDirty();
  },

  splitAtPlayhead: () => {
    const { clips, currentTime } = get();
    const clipUnderPlayhead = clips.find((c) => {
      const end = c.offset + clipDuration(c);
      return currentTime > c.offset && currentTime < end;
    });
    if (clipUnderPlayhead) get().splitClipAtPlayhead(clipUnderPlayhead.id);
  },

  addBlankClip: (duration, background, track, _offset) => {
    const id = generateId();
    const trackClips = get().clips.filter((c) => c.track === track);
    let endOfTrack = 0;
    for (const c of trackClips) endOfTrack = Math.max(endOfTrack, c.offset + clipDuration(c));
    const clip: Clip = {
      id, sourceId: '', sourcePath: '', sourceName: 'Blank',
      type: 'blank', start: 0, end: duration, track, offset: endOfTrack,
      speed: 1, audioVolume: 0, fadeIn: 0, fadeOut: 0,
      blankBackground: background,
    };
    set((state) => ({ clips: [...state.clips, clip] }));
    get().realignTrack(track);
    get().recalculateDuration();
    get().markDirty();
    return id;
  },

  // ---- Text Overlays ----
  addTextOverlay: (partial) => {
    const id = generateId();
    const { currentTime, duration } = get();
    const overlay: TextOverlay = {
      id, text: 'Your Text', x: 0.5, y: 0.5, width: 0.6, height: 0.15,
      rotation: 0,
      startTime: currentTime,
      endTime: Math.max(currentTime + 3, Math.min(currentTime + 5, duration || currentTime + 5)),
      layer: get().textOverlays.length,
      style: { ...DEFAULT_TEXT_STYLE },
      animation: { type: 'none' },
      ...partial,
    };
    set((state) => ({ textOverlays: [...state.textOverlays, overlay] }));
    get().recalculateDuration();
    get().markDirty();
    return id;
  },

  updateTextOverlay: (id, updates) => {
    set((state) => ({
      textOverlays: state.textOverlays.map((o) => o.id === id ? { ...o, ...updates } : o),
    }));
    get().markDirty();
  },

  removeTextOverlay: (id) => {
    set((state) => ({
      textOverlays: state.textOverlays.filter((o) => o.id !== id),
      selectedOverlayId: state.selectedOverlayId === id ? null : state.selectedOverlayId,
      selectedOverlayType: state.selectedOverlayId === id ? null : state.selectedOverlayType,
    }));
    get().markDirty();
  },

  // ---- Image Overlays ----
  addImageOverlay: (src, name, file) => {
    const id = generateId();
    const { currentTime, duration } = get();
    const overlay: ImageOverlay = {
      id, src, name, x: 0.5, y: 0.5, width: 0.3, height: 0.3,
      rotation: 0, opacity: 1,
      startTime: currentTime,
      endTime: Math.max(currentTime + 3, Math.min(currentTime + 5, duration || currentTime + 5)),
      layer: get().imageOverlays.length,
      maintainAspectRatio: true, file,
    };
    set((state) => ({ imageOverlays: [...state.imageOverlays, overlay] }));
    get().recalculateDuration();
    get().markDirty();
    return id;
  },

  updateImageOverlay: (id, updates) => {
    set((state) => ({
      imageOverlays: state.imageOverlays.map((o) => o.id === id ? { ...o, ...updates } : o),
    }));
    get().markDirty();
  },

  removeImageOverlay: (id) => {
    set((state) => ({
      imageOverlays: state.imageOverlays.filter((o) => o.id !== id),
      selectedOverlayId: state.selectedOverlayId === id ? null : state.selectedOverlayId,
      selectedOverlayType: state.selectedOverlayId === id ? null : state.selectedOverlayType,
    }));
    get().markDirty();
  },

  // ---- Transitions ----
  addTransition: (data) => {
    if (data.fromClipId === data.toClipId) return '';
    const id = generateId();
    set((state) => ({ transitions: [...state.transitions, { ...data, id }] }));
    const fromClip = get().clips.find((c) => c.id === data.fromClipId);
    if (fromClip) get().realignTrack(fromClip.track);
    get().recalculateDuration();
    get().markDirty();
    return id;
  },

  updateTransition: (id, updates) => {
    set((state) => ({
      transitions: state.transitions.map((t) => t.id === id ? { ...t, ...updates } : t),
    }));
    const tr = get().transitions.find((t) => t.id === id);
    if (tr) {
      const fromClip = get().clips.find((c) => c.id === tr.fromClipId);
      if (fromClip) get().realignTrack(fromClip.track);
    }
    get().recalculateDuration();
    get().markDirty();
  },

  removeTransition: (id) => {
    const tr = get().transitions.find((t) => t.id === id);
    set((state) => ({ transitions: state.transitions.filter((t) => t.id !== id) }));
    if (tr) {
      const fromClip = get().clips.find((c) => c.id === tr.fromClipId);
      if (fromClip) get().realignTrack(fromClip.track);
    }
    get().recalculateDuration();
    get().markDirty();
  },

  // ---- Selection ----
  selectClip: (id, multi = false) =>
    set((state) => {
      if (multi) {
        const isSelected = state.selectedClipIds.includes(id);
        return {
          selectedClipIds: isSelected
            ? state.selectedClipIds.filter((sid) => sid !== id)
            : [...state.selectedClipIds, id],
          selectedOverlayId: null, selectedOverlayType: null,
        };
      }
      return { selectedClipIds: [id], selectedOverlayId: null, selectedOverlayType: null };
    }),

  selectOverlay: (id, type) =>
    set({ selectedOverlayId: id, selectedOverlayType: type, selectedClipIds: [] }),

  clearSelection: () =>
    set({ selectedClipIds: [], selectedOverlayId: null, selectedOverlayType: null }),

  // ---- Playback / View ----
  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setZoom: (zoom) => set({ zoom: Math.max(1, Math.min(50, zoom)) }),
  setActiveMedia: (id) => set({ activeMediaId: id }),

  // ---- Export ----
  setExportSettings: (settings) =>
    set((state) => ({ exportSettings: { ...state.exportSettings, ...settings } })),
  setIsExporting: (exporting) => set({ isExporting: exporting }),
  setExportProgress: (progress) => set({ exportProgress: progress }),

  // ---- Tracks ----
  addTrack: (type) => {
    set((state) => {
      const label = type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Overlay';
      const count = state.tracks.filter((t) => t.type === type).length + 1;
      return {
        tracks: [...state.tracks, {
          id: generateId(), name: `${label} ${count}`, type, muted: false, locked: false,
        }],
      };
    });
    get().markDirty();
  },

  toggleTrackMute: (id) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t)),
    })),

  toggleTrackLock: (id) =>
    set((state) => ({
      tracks: state.tracks.map((t) => (t.id === id ? { ...t, locked: !t.locked } : t)),
    })),

  // ---- Realignment Engine ----
  realignTrack: (trackIndex) => {
    const { clips, transitions } = get();
    const realigned = computeRealignment(clips, transitions, trackIndex);
    set({ clips: realigned });
  },

  realignAllTracks: () => {
    const { tracks } = get();
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].type !== 'overlay') get().realignTrack(i);
    }
  },

  // ---- Utils ----
  recalculateDuration: () => {
    const { clips, textOverlays, imageOverlays } = get();
    let maxEnd = 0;
    for (const c of clips) maxEnd = Math.max(maxEnd, c.offset + clipDuration(c));
    for (const t of textOverlays) maxEnd = Math.max(maxEnd, t.endTime);
    for (const i of imageOverlays) maxEnd = Math.max(maxEnd, i.endTime);
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
