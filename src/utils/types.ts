export type MediaType = 'video' | 'audio' | 'image';

export interface MediaFile {
  id: string;
  name: string;
  path: string;
  type: MediaType;
  duration: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  fileSize: number;
  /** Original File object for re-creating blob URLs if needed */
  file?: File;
}

export interface Clip {
  id: string;
  sourceId: string;
  sourcePath: string;
  sourceName: string;
  type: MediaType;
  start: number;
  end: number;
  track: number;
  offset: number;
  speed: number;
  audioVolume: number;
  fadeIn: number;
  fadeOut: number;
  thumbnail?: string;
}

export interface Track {
  id: string;
  name: string;
  type: 'video' | 'audio';
  muted: boolean;
  locked: boolean;
}

export interface ExportSettings {
  format: 'mp4' | 'webm' | 'avi';
  resolution: '1920x1080' | '1280x720' | '854x480' | '640x360';
  fps: 24 | 30 | 60;
  quality: 'high' | 'medium' | 'low';
}

export type HistoryAction = {
  type: string;
  undo: () => void;
  redo: () => void;
};
