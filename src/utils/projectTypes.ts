import {
  Clip, Track, TextOverlay, ImageOverlay, Transition, ExportSettings,
} from './types';

export interface ProjectAsset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  size: number;
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
}

export interface ProjectData {
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  version: number;

  clips: Clip[];
  tracks: Track[];
  textOverlays: TextOverlay[];
  imageOverlays: Omit<ImageOverlay, 'file'>[];
  transitions: Transition[];
  exportSettings: ExportSettings;

  assets: ProjectAsset[];

  viewState: {
    currentTime: number;
    zoom: number;
  };
}

export interface ProjectMeta {
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  thumbnail?: string;
  clipCount: number;
  duration: number;
  version: number;
}

export const PROJECT_DB_NAME = 'VideoEditorProjects';
export const PROJECT_DB_VERSION = 1;
export const STORE_PROJECTS = 'projects';
export const STORE_ASSETS = 'assets';
export const STORE_META = 'meta';

export const AUTOSAVE_INTERVAL = 30_000;
export const AUTOSAVE_PROJECT_NAME = '__autosave__';
