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
  file?: File;
}

export interface Clip {
  id: string;
  sourceId: string;
  sourcePath: string;
  sourceName: string;
  type: MediaType | 'blank';
  start: number;
  end: number;
  track: number;
  offset: number;
  speed: number;
  audioVolume: number;
  fadeIn: number;
  fadeOut: number;
  thumbnail?: string;
  blankBackground?: string;
}

export interface Track {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'overlay';
  muted: boolean;
  locked: boolean;
}

export interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  startTime: number;
  endTime: number;
  layer: number;
  style: TextStyle;
  animation?: TextAnimation;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  backgroundColor: string;
  backgroundOpacity: number;
  letterSpacing: number;
  lineHeight: number;
}

export type TextAnimation =
  | { type: 'none' }
  | { type: 'fadeIn'; duration: number }
  | { type: 'fadeOut'; duration: number }
  | { type: 'fadeInOut'; fadeInDuration: number; fadeOutDuration: number }
  | { type: 'slideIn'; direction: 'left' | 'right' | 'up' | 'down'; duration: number }
  | { type: 'slideOut'; direction: 'left' | 'right' | 'up' | 'down'; duration: number }
  | { type: 'typewriter'; speed: number }
  | { type: 'scale'; from: number; to: number; duration: number };

export interface ImageOverlay {
  id: string;
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  startTime: number;
  endTime: number;
  layer: number;
  maintainAspectRatio: boolean;
  file?: File;
}

export type TransitionType =
  | 'fade'
  | 'crossDissolve'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'zoom'
  | 'blur'
  | 'wipe';

export interface Transition {
  id: string;
  type: TransitionType;
  duration: number;
  fromClipId: string;
  toClipId: string;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Arial',
  fontSize: 48,
  color: '#ffffff',
  bold: false,
  italic: false,
  underline: false,
  align: 'center',
  strokeColor: '#000000',
  strokeWidth: 0,
  shadowColor: '#000000',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  backgroundColor: 'transparent',
  backgroundOpacity: 0,
  letterSpacing: 0,
  lineHeight: 1.2,
};

export const TEXT_PRESETS: Record<string, { name: string; style: Partial<TextStyle> }> = {
  title: {
    name: 'Title',
    style: { fontSize: 72, bold: true, strokeWidth: 2, strokeColor: '#000000' },
  },
  subtitle: {
    name: 'Subtitle',
    style: { fontSize: 36, color: '#e0e0e0' },
  },
  caption: {
    name: 'Caption',
    style: {
      fontSize: 28, backgroundColor: '#000000', backgroundOpacity: 0.7,
      color: '#ffffff',
    },
  },
  heading: {
    name: 'Heading',
    style: { fontSize: 56, bold: true, letterSpacing: 2 },
  },
  lowerThird: {
    name: 'Lower Third',
    style: {
      fontSize: 32, backgroundColor: '#1a1a2e', backgroundOpacity: 0.85,
      color: '#ffffff', bold: true,
    },
  },
};

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
