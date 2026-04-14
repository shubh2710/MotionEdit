const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#030712',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const isDev = process.argv.includes('--dev') || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media Files', extensions: [
        'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', '3gp', '3g2', 'ts', 'mts', 'm2ts', 'hevc', 'mpg', 'mpeg', 'ogv',
        'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma', 'amr', 'caf', 'opus',
        'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'avif', 'tiff', 'tif', 'dng', 'raw',
      ]},
      { name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', '3gp', '3g2', 'ts', 'mts', 'hevc', 'mpg', 'mpeg'] },
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma', 'amr', 'caf', 'opus'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'avif', 'tiff', 'tif', 'dng'] },
    ],
  });
  return result.filePaths;
});

ipcMain.handle('dialog:saveFile', async (_event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'output.mp4',
    filters: [
      { name: 'MP4', extensions: ['mp4'] },
      { name: 'WebM', extensions: ['webm'] },
      { name: 'AVI', extensions: ['avi'] },
    ],
  });
  return result.filePath;
});

ipcMain.handle('ffmpeg:getInfo', async (_event, filePath) => {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => { output += data.toString(); });
    ffprobe.stderr.on('data', () => {});
    ffprobe.on('close', (code) => {
      if (code === 0) {
        try { resolve(JSON.parse(output)); }
        catch { reject(new Error('Failed to parse ffprobe output')); }
      } else {
        reject(new Error(`ffprobe exited with code ${code}`));
      }
    });
  });
});

ipcMain.handle('ffmpeg:export', async (event, args) => {
  const { commands, outputPath } = args;
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', commands, { shell: true });
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
      const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch) {
        const seconds = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        event.sender.send('ffmpeg:progress', { seconds });
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve({ success: true, outputPath });
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
    });
  });
});

ipcMain.handle('ffmpeg:generateThumbnail', async (_event, { filePath, time, outputPath }) => {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y', '-i', filePath,
      '-ss', String(time || 1),
      '-vframes', '1',
      '-vf', 'scale=192:-1',
      outputPath,
    ]);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`Thumbnail generation failed`));
    });
  });
});

ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow.close());
