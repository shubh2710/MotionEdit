/**
 * FFmpeg Service - handles all video processing operations.
 * Used by the Electron main process for export, trim, merge, and speed operations.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class FFmpegService {
  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'video-editor-temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async trim(inputPath, startTime, endTime, outputPath) {
    const args = [
      '-y', '-i', inputPath,
      '-ss', String(startTime),
      '-to', String(endTime),
      '-c', 'copy',
      outputPath,
    ];
    return this._run(args);
  }

  async merge(inputPaths, outputPath) {
    const listFile = path.join(this.tempDir, `concat-${Date.now()}.txt`);
    const content = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFile, content);

    const args = [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outputPath,
    ];

    try {
      const result = await this._run(args);
      fs.unlinkSync(listFile);
      return result;
    } catch (err) {
      fs.unlinkSync(listFile);
      throw err;
    }
  }

  async changeSpeed(inputPath, speed, outputPath) {
    const videoFilter = `setpts=${1 / speed}*PTS`;
    const audioFilter = `atempo=${speed}`;

    const args = [
      '-y', '-i', inputPath,
      '-filter:v', videoFilter,
      '-filter:a', audioFilter,
      outputPath,
    ];
    return this._run(args);
  }

  async exportTimeline(clips, settings, outputPath, onProgress) {
    const { resolution, fps, quality } = settings;
    const [w, h] = resolution.split('x');
    const crfMap = { high: '18', medium: '23', low: '28' };
    const crf = crfMap[quality] || '23';

    if (clips.length === 0) throw new Error('No clips to export');

    const sortedClips = [...clips].sort((a, b) => a.offset - b.offset);

    if (sortedClips.length === 1) {
      const clip = sortedClips[0];
      const duration = (clip.end - clip.start) / clip.speed;
      const args = [
        '-y', '-i', clip.sourcePath,
        '-ss', String(clip.start),
        '-t', String(duration),
        ...(clip.speed !== 1 ? ['-filter:v', `setpts=${1 / clip.speed}*PTS`] : []),
        '-vf', `scale=${w}:${h}`,
        '-r', String(fps),
        '-crf', crf,
        '-preset', 'medium',
        outputPath,
      ];
      return this._run(args, onProgress);
    }

    const inputs = [];
    const filterParts = [];

    sortedClips.forEach((clip, i) => {
      inputs.push('-i', clip.sourcePath);
      const speedFilter = clip.speed !== 1 ? `,setpts=${1 / clip.speed}*PTS` : '';
      filterParts.push(
        `[${i}:v]trim=start=${clip.start}:end=${clip.end},setpts=PTS-STARTPTS${speedFilter},scale=${w}:${h}[v${i}]`
      );
    });

    const concatInputs = sortedClips.map((_, i) => `[v${i}]`).join('');
    filterParts.push(`${concatInputs}concat=n=${sortedClips.length}:v=1:a=0[outv]`);

    const args = [
      '-y', ...inputs,
      '-filter_complex', filterParts.join(';'),
      '-map', '[outv]',
      '-r', String(fps),
      '-crf', crf,
      '-preset', 'medium',
      outputPath,
    ];

    return this._run(args, onProgress);
  }

  async generateThumbnail(inputPath, time, outputPath) {
    const args = [
      '-y', '-i', inputPath,
      '-ss', String(time || 1),
      '-vframes', '1',
      '-vf', 'scale=192:-1',
      outputPath,
    ];
    return this._run(args);
  }

  _run(args, onProgress) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;

        if (onProgress) {
          const timeMatch = chunk.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (timeMatch) {
            const seconds =
              parseInt(timeMatch[1]) * 3600 +
              parseInt(timeMatch[2]) * 60 +
              parseFloat(timeMatch[3]);
            onProgress({ seconds, raw: chunk });
          }
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          reject(new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-500)}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`Failed to start FFmpeg: ${err.message}`));
      });
    });
  }

  cleanup() {
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        files.forEach((file) => {
          fs.unlinkSync(path.join(this.tempDir, file));
        });
      }
    } catch (_) {
      // Best effort cleanup
    }
  }
}

module.exports = { FFmpegService };
