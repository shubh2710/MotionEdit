import React, { useState, useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { ExportSettings } from '../utils/types';
import { browserExportVideo, downloadBlob, ExportStatus } from '../utils/browserExport';
import { getExportLockState, WakeLockState } from '../utils/exportWakeLock';

interface ExportModalProps {
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ onClose }) => {
  const { clips, tracks, textOverlays, imageOverlays, transitions, exportSettings, setExportSettings, isExporting, exportProgress } = useEditorStore();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [lockState, setLockState] = useState<WakeLockState | null>(null);

  useEffect(() => {
    if (!isExporting) { setLockState(null); return; }
    const id = setInterval(() => setLockState(getExportLockState()), 2000);
    return () => clearInterval(id);
  }, [isExporting]);

  const isBrowser = !window.electronAPI;
  const hasWebCodecs = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
  const hasContent = clips.length > 0 || textOverlays.length > 0 || imageOverlays.length > 0;
  const canExport = hasContent && !isExporting;

  const handleExport = async () => {
    if (!canExport) return;
    setExportError(null);
    setStatusMessage(null);
    setExportStatus(null);

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
        await browserExportVideo({
          clips, tracks, textOverlays, imageOverlays, transitions,
          settings: exportSettings,
        }, {
          onProgress: (percent) => {
            useEditorStore.getState().setExportProgress(percent);
          },
          onStatus: (status) => {
            setExportStatus(status);
            setStatusMessage(status.detail);
          },
          onComplete: (blob, filename) => {
            downloadBlob(blob, filename);
            setStatusMessage(`Export complete! File "${filename}" downloaded (${formatBlobSize(blob.size)})`);
            setExportStatus((prev) => prev ? { ...prev, phase: 'Complete' } : null);
            useEditorStore.getState().setIsExporting(false);
            useEditorStore.getState().setExportProgress(100);
          },
          onError: (error) => {
            setExportError(error);
            setExportStatus(null);
            useEditorStore.getState().setIsExporting(false);
          },
        });
      } catch (err) {
        setExportError(`Export failed: ${err}`);
        useEditorStore.getState().setIsExporting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={isExporting ? undefined : onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[440px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 className="text-lg font-semibold">Export Video</h3>
          <button onClick={onClose} disabled={isExporting} className="text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
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
            <div className="space-y-3">
              {/* Step indicator */}
              {exportStatus && (
                <div className="flex items-center gap-2">
                  {Array.from({ length: exportStatus.totalSteps }, (_, i) => {
                    const stepNum = i + 1;
                    const isDone = stepNum < exportStatus.step;
                    const isActive = stepNum === exportStatus.step;
                    return (
                      <div key={i} className="flex items-center gap-1.5">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0
                          ${isDone ? 'bg-green-600 text-white' : isActive ? 'bg-blue-500 text-white animate-pulse' : 'bg-gray-700 text-gray-500'}`}>
                          {isDone ? '✓' : stepNum}
                        </div>
                        {i < exportStatus.totalSteps - 1 && (
                          <div className={`h-0.5 w-4 rounded ${isDone ? 'bg-green-600' : 'bg-gray-700'}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Phase & detail */}
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-medium text-blue-400">{exportStatus?.phase || 'Exporting…'}</span>
                  <span className="text-xs font-mono text-gray-400">{exportProgress}%</span>
                </div>
                <p className="text-xs text-gray-500">{exportStatus?.detail || statusMessage || 'Preparing…'}</p>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-300"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>

              {/* Frame counter + timing row */}
              {exportStatus && (
                <div className="flex justify-between text-[11px] text-gray-500 font-mono">
                  <span>
                    {exportStatus.currentFrame != null && exportStatus.totalFrames != null
                      ? `Frame ${exportStatus.currentFrame} / ${exportStatus.totalFrames}`
                      : `Step ${exportStatus.step} / ${exportStatus.totalSteps}`}
                  </span>
                  <span>
                    {formatMs(exportStatus.elapsedMs)} elapsed
                    {exportStatus.estimatedTotalMs != null && exportStatus.estimatedTotalMs > exportStatus.elapsedMs && (
                      <> · ~{formatMs(exportStatus.estimatedTotalMs - exportStatus.elapsedMs)} left</>
                    )}
                  </span>
                </div>
              )}

              {/* Sleep protection status */}
              {lockState && (
                <div className="bg-gray-800/60 rounded-lg px-3 py-2 space-y-1.5">
                  <p className="text-[11px] font-medium text-gray-400">Sleep Protection Active</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <LockBadge active={lockState.screenLock} label="Screen wake lock" />
                    <LockBadge active={lockState.audioLock} label="Tab keepalive" />
                    <LockBadge active={lockState.unloadGuard} label="Close guard" />
                  </div>
                  <p className="text-[10px] text-gray-600 leading-tight">
                    Keep this tab visible for best performance. Progress is shown in the tab title if you switch tabs.
                  </p>
                </div>
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

const LockBadge: React.FC<{ active: boolean; label: string }> = ({ active, label }) => (
  <span className={`inline-flex items-center gap-1 text-[10px] ${active ? 'text-green-400' : 'text-yellow-500'}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400' : 'bg-yellow-500'}`} />
    {label}
  </span>
);

function formatMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
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
