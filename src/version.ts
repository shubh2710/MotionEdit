export const APP_VERSION = '1.1.0';
export const APP_NAME = 'MotionEdit';
export const APP_BUILD_DATE = '2026-04-14';

export const CHANGELOG: { version: string; date: string; changes: string[] }[] = [
  {
    version: '1.1.0',
    date: '2026-04-14',
    changes: [
      'Local FFmpeg export service for 10-50x faster encoding',
      'Hardware acceleration auto-detection (NVENC/QSV/AMF)',
      'Export sleep protection (wake lock, tab keepalive, close guard)',
      'Audio stream probing to prevent export failures',
      'Smooth CFR output with monotonic timestamps',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-04-12',
    changes: [
      'Initial release with timeline editor',
      'Video/audio/image clip support',
      'Transitions, text overlays, image overlays',
      'No-gap timeline with auto-alignment',
      'Project save/load/import/export via IndexedDB',
      'Browser-based WebCodecs H.264 export',
    ],
  },
];
