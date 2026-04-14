interface ElectronAPI {
  openFiles: () => Promise<string[]>;
  saveFile: (defaultName?: string) => Promise<string | undefined>;
  getMediaInfo: (filePath: string) => Promise<any>;
  exportVideo: (args: { commands: string[]; outputPath: string }) => Promise<{ success: boolean; outputPath: string }>;
  generateThumbnail: (args: { filePath: string; time?: number; outputPath: string }) => Promise<string>;
  onExportProgress: (callback: (data: { seconds: number }) => void) => void;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
