import React, { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { ExportSettings } from '../utils/types';
import { browserExportVideo, downloadBlob } from '../utils/browserExport';

interface ExportModalProps {
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ onClose }) => {
  const { clips, tracks, exportSettings, setExportSettings, isExporting, exportProgress } = useEditorStore();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const isBrowser = !window.electronAPI;
  const hasWebCodecs = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
  const canExport = clips.length > 0 && !isExporting;

  const handleExport = async () => {
    if (!canExport) return;
    setExportError(null);
    setStatusMessage(null);

    if (window.electronAPI) {
      const path = await window.electronAPI.saveFile(`output.${exportSettings.format}`);
      if (!path) return;

      useEditorStore.getState().setIsExporting(true);
      useEditorStore.getState().setExportProgress(0);

      const sortedClips = [...clips].sort((a, b) => a.offset - b.offset);
      const commands = buildFFmpegCommands(sortedClips, exportSettings, path);

      try {
        await window.electronAPI.exportVideo({ commands, outputPath: path });
        setStatusMessage('Export completed successfully!');
      } catch (err) {
        setExportError(`Export failed: ${err}`);
      } finally {
        useEditorStore.getState().setIsExporting(false);
      }
    } else {
      useEditorStore.getState().setIsExporting(true);
      useEditorStore.getState().setExportProgress(0);
      const isMP4 = exportSettings.format !== 'webm';
      const mode = isMP4
        ? hasWebCodecs
          ? 'Encoding H.264 video + loading FFmpeg for AAC audio...'
          : 'Capturing video — will convert to MP4 via FFmpeg...'
        : 'Capturing WebM...';
      setStatusMessage(mode);

      try {
        await browserExportVideo(clips, tracks, exportSettings, {
          onProgress: (percent) => {
            useEditorStore.getState().setExportProgress(percent);
            if (percent > 0 && percent < 100) {
              const isConverting = !hasWebCodecs && percent >= 55;
              setStatusMessage(
                isConverting
                  ? `Converting to MP4 (H.264+AAC)... ${percent}% — this may take a few minutes`
                  : `Rendering... ${percent}%`
              );
            }
          },
          onComplete: (blob, filename) => {
            downloadBlob(blob, filename);
            setStatusMessage(`Export complete! File "${filename}" downloaded (${formatBlobSize(blob.size)})`);
            useEditorStore.getState().setIsExporting(false);
            useEditorStore.getState().setExportProgress(100);
          },
          onError: (error) => {
            setExportError(error);
            useEditorStore.getState().setIsExporting(false);
          },
        });
      } catch (err) {
        setExportError(`Export failed: ${err}`);
        useEditorStore.getState().setIsExporting(false);
      }
    }
  };

  const estimatedTime = clips.length > 0
    ? Math.max(...clips.map((c) => c.offset + (c.end - c.start) / c.speed))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[440px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 className="text-lg font-semibold">Export Video</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Browser mode notice */}
          {isBrowser && hasWebCodecs && (
            <div className="bg-green-900/20 border border-green-800/40 rounded-lg px-3 py-2 text-xs text-green-300">
              <p className="font-medium mb-0.5">High-Quality Export (H.264 + AAC)</p>
              <p className="text-green-400/80">
                Hardware-accelerated video encoding with AAC audio. YouTube, Instagram, and all players compatible.
              </p>
            </div>
          )}
          {isBrowser && !hasWebCodecs && (
            <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-3 py-2 text-xs text-yellow-300">
              <p className="font-medium mb-0.5">Browser Export Mode</p>
              <p className="text-yellow-400/80">
                MP4 export uses real-time capture + conversion (takes longer). WebM is faster but less compatible.
              </p>
            </div>
          )}

          {/* Format */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Format</label>
            <div className="grid grid-cols-2 gap-2">
              {(['mp4', 'webm'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setExportSettings({ format: fmt })}
                  disabled={isExporting}
                  className={`py-2 rounded-lg text-sm font-medium transition-colors uppercase
                    ${exportSettings.format === fmt
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}
                    disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {fmt}
                  {fmt === 'mp4' && isBrowser && (
                    <span className="text-[10px] ml-1 opacity-70 normal-case">(H.264+AAC)</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Resolution</label>
            <select
              value={exportSettings.resolution}
              onChange={(e) => setExportSettings({ resolution: e.target.value as ExportSettings['resolution'] })}
              disabled={isExporting}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="1920x1080">1920 x 1080 (Full HD)</option>
              <option value="1280x720">1280 x 720 (HD)</option>
              <option value="854x480">854 x 480 (SD)</option>
              <option value="640x360">640 x 360</option>
            </select>
          </div>

          {/* Frame Rate */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Frame Rate</label>
            <div className="grid grid-cols-3 gap-2">
              {([24, 30, 60] as const).map((fps) => (
                <button
                  key={fps}
                  onClick={() => setExportSettings({ fps })}
                  disabled={isExporting}
                  className={`py-2 rounded-lg text-sm font-medium transition-colors
                    ${exportSettings.fps === fps
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}
                    disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {fps} FPS
                </button>
              ))}
            </div>
          </div>

          {/* Quality */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Quality</label>
            <div className="grid grid-cols-3 gap-2">
              {(['high', 'medium', 'low'] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => setExportSettings({ quality: q })}
                  disabled={isExporting}
                  className={`py-2 rounded-lg text-sm font-medium capitalize transition-colors
                    ${exportSettings.quality === q
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}
                    disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Progress */}
          {isExporting && (
            <div>
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>{statusMessage || 'Exporting...'}</span>
                <span>{exportProgress}%</span>
              </div>
              <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-200"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
              {isBrowser && !hasWebCodecs && exportProgress > 0 && exportProgress < 100 && (
                <p className="text-[10px] text-gray-500 mt-1">
                  ~{Math.ceil(estimatedTime * (1 - exportProgress / 100))}s remaining (real-time render)
                </p>
              )}
            </div>
          )}

          {/* Success message */}
          {!isExporting && statusMessage && !exportError && (
            <div className="bg-green-900/20 border border-green-800/40 rounded-lg px-3 py-2 text-xs text-green-300">
              {statusMessage}
            </div>
          )}

          {/* Error */}
          {exportError && (
            <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2 text-xs text-red-300">
              {exportError}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={isExporting}
              className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isExporting ? 'Exporting...' : 'Close'}
            </button>
            <button
              onClick={handleExport}
              disabled={!canExport}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2
                ${canExport
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}
            >
              {isExporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Rendering...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function formatBlobSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildFFmpegCommands(clips: any[], settings: ExportSettings, outputPath: string): string[] {
  const [w, h] = settings.resolution.split('x');
  const crfMap = { high: '18', medium: '23', low: '28' };
  const crf = crfMap[settings.quality];

  if (clips.length === 1) {
    const clip = clips[0];
    return [
      '-y', '-i', clip.sourcePath,
      '-ss', String(clip.start),
      '-t', String((clip.end - clip.start) / clip.speed),
      ...(clip.speed !== 1 ? ['-filter:v', `setpts=${1 / clip.speed}*PTS`] : []),
      '-vf', `scale=${w}:${h}`,
      '-r', String(settings.fps),
      '-crf', crf,
      '-preset', 'medium',
      outputPath,
    ];
  }

  const inputs: string[] = [];
  const filterParts: string[] = [];

  clips.forEach((clip: any, i: number) => {
    inputs.push('-i', clip.sourcePath);
    const speed = clip.speed !== 1 ? `,setpts=${1 / clip.speed}*PTS` : '';
    filterParts.push(
      `[${i}:v]trim=start=${clip.start}:end=${clip.end},setpts=PTS-STARTPTS${speed},scale=${w}:${h}[v${i}]`
    );
  });

  const concatInputs = clips.map((_: any, i: number) => `[v${i}]`).join('');
  filterParts.push(`${concatInputs}concat=n=${clips.length}:v=1:a=0[outv]`);

  return [
    '-y', ...inputs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[outv]',
    '-r', String(settings.fps),
    '-crf', crf,
    '-preset', 'medium',
    outputPath,
  ];
}
