import { createFile, DataStream, Endianness, type Sample, type Track as MP4Track, type Movie, MP4BoxBuffer } from 'mp4box';

export interface FrameProvider {
  getFrameAt(timeInSeconds: number): CanvasImageSource | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function extractDescription(mp4File: any, trackId: number): Uint8Array | undefined {
  // Method 1: getTrackById → stsd entries → codec config box
  try {
    const trak = mp4File.getTrackById?.(trackId);
    if (trak) {
      const entries = trak.mdia?.minf?.stbl?.stsd?.entries;
      if (entries) {
        for (const entry of entries) {
          const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
          if (box && typeof box.write === 'function') {
            const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
            box.write(stream);
            const desc = new Uint8Array(stream.buffer, 8);
            if (desc.byteLength > 0) {
              console.log('[Demuxer] description via getTrackById: %d bytes', desc.byteLength);
              return desc;
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Demuxer] method 1 (getTrackById) failed:', e);
  }

  // Method 2: walk moov.traks directly
  try {
    const traks = mp4File.moov?.traks;
    if (traks) {
      for (const trak of traks) {
        if (trak.tkhd?.track_id !== trackId) continue;
        const entries = trak.mdia?.minf?.stbl?.stsd?.entries;
        if (!entries) continue;
        for (const entry of entries) {
          const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
          if (box && typeof box.write === 'function') {
            const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
            box.write(stream);
            const desc = new Uint8Array(stream.buffer, 8);
            if (desc.byteLength > 0) {
              console.log('[Demuxer] description via moov.traks: %d bytes', desc.byteLength);
              return desc;
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Demuxer] method 2 (moov.traks) failed:', e);
  }

  console.warn('[Demuxer] could not extract codec description');
  return undefined;
}

export class ClipFrameDecoder implements FrameProvider {
  private blobUrl: string;
  private mp4File: ReturnType<typeof createFile> | null = null;
  private samples: Sample[] = [];
  private videoTrack: MP4Track | null = null;
  private decoderConfig: VideoDecoderConfig | null = null;

  private frameCache = new Map<number, ImageBitmap>();
  private closed = false;

  constructor(blobUrl: string) {
    this.blobUrl = blobUrl;
  }

  async init(): Promise<void> {
    console.log('[Demuxer] init: fetching', this.blobUrl.slice(0, 80));
    const response = await fetch(this.blobUrl);
    const arrayBuffer = await response.arrayBuffer();
    console.log('[Demuxer] fetched %.1f MB', arrayBuffer.byteLength / 1024 / 1024);

    if (arrayBuffer.byteLength < 8) throw new Error('File too small to be MP4');

    const mp4boxBuf = MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Demux init timed out (10s)')), 10_000);

      const file = createFile();
      this.mp4File = file;

      file.onReady = (info: Movie) => {
        const vTrack = info.videoTracks[0];
        if (!vTrack) { clearTimeout(timeout); reject(new Error('No video track')); return; }

        console.log('[Demuxer] onReady: codec=%s %dx%d, %d samples, ts=%d',
          vTrack.codec, vTrack.video?.width, vTrack.video?.height, vTrack.nb_samples, vTrack.timescale);

        this.videoTrack = vTrack;

        const description = extractDescription(file, vTrack.id);

        const config: VideoDecoderConfig = {
          codec: vTrack.codec,
          codedWidth: vTrack.video?.width ?? vTrack.track_width,
          codedHeight: vTrack.video?.height ?? vTrack.track_height,
          hardwareAcceleration: 'prefer-hardware',
        };
        if (description) config.description = description;
        this.decoderConfig = config;

        file.setExtractionOptions(vTrack.id);
        file.start();
      };

      file.onSamples = (_id: number, _user: unknown, samples: Sample[]) => {
        this.samples.push(...samples);
      };

      file.onError = (_mod: string, msg: string) => { clearTimeout(timeout); reject(new Error(msg)); };

      file.appendBuffer(mp4boxBuf);
      file.flush();

      const waitDone = () => {
        if (this.videoTrack && this.samples.length > 0) {
          clearTimeout(timeout);
          const withData = this.samples.filter((s) => !!s.data).length;
          console.log('[Demuxer] init done: %d samples (%d with data)', this.samples.length, withData);
          if (withData === 0) {
            reject(new Error('All samples lack data — extraction failed'));
          } else {
            resolve();
          }
        } else {
          setTimeout(waitDone, 50);
        }
      };
      setTimeout(waitDone, 50);
    });
  }

  async preDecodeRange(
    startTime: number,
    endTime: number,
    fps: number,
    onProgress?: (decoded: number, total: number) => void,
  ): Promise<void> {
    if (!this.decoderConfig) throw new Error('No decoder config');

    // Validate that the browser can actually decode this config
    const support = await VideoDecoder.isConfigSupported(this.decoderConfig);
    if (!support.supported) {
      throw new Error(`VideoDecoder does not support config: ${this.decoderConfig.codec} (desc=${!!this.decoderConfig.description})`);
    }
    console.log('[Demuxer] config supported ✓');

    const samplesWithData = this.samples.filter((s) => !!s.data);
    if (samplesWithData.length === 0) throw new Error('No samples with data');

    const timescale = this.videoTrack!.timescale;
    const startPTS = Math.floor(startTime * timescale);
    const endPTS = Math.ceil(endTime * timescale);

    // Find range: walk to first sample >= startPTS, then back to nearest keyframe
    let firstRelevantIdx = samplesWithData.length - 1;
    for (let i = 0; i < samplesWithData.length; i++) {
      const pts = samplesWithData[i].cts ?? samplesWithData[i].dts;
      if (pts >= startPTS) { firstRelevantIdx = i; break; }
    }

    let keyframeIdx = 0;
    for (let i = firstRelevantIdx; i >= 0; i--) {
      if (samplesWithData[i].is_sync) { keyframeIdx = i; break; }
    }

    let endIdx = samplesWithData.length;
    for (let i = keyframeIdx; i < samplesWithData.length; i++) {
      const pts = samplesWithData[i].cts ?? samplesWithData[i].dts;
      if (pts > endPTS + timescale) { endIdx = i; break; }
    }

    let finalSamples = samplesWithData.slice(keyframeIdx, endIdx);

    // Guarantee first sample is a keyframe
    const firstKeyIdx = finalSamples.findIndex((s) => s.is_sync);
    if (firstKeyIdx < 0) throw new Error('No keyframe in range');
    if (firstKeyIdx > 0) finalSamples = finalSamples.slice(firstKeyIdx);

    console.log('[Demuxer] decoding %d samples (range %.2f–%.2f s)', finalSamples.length, startTime, endTime);

    const totalSamples = finalSamples.length;
    const pendingFrames = new Map<number, VideoFrame>();
    let decodedCount = 0;
    let chunksQueued = 0;
    let decodeError: string | null = null;

    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        pendingFrames.set(frame.timestamp, frame);
        decodedCount++;
        if (onProgress && decodedCount % 50 === 0) {
          onProgress(decodedCount, totalSamples);
        }
      },
      error: (e: DOMException) => {
        decodeError = e.message;
        console.error('[Demuxer] decode error:', e.message);
      },
    });

    decoder.configure(this.decoderConfig);
    if (decoder.state !== 'configured') {
      throw new Error(`Decoder state after configure: ${decoder.state}`);
    }

    // Feed a small batch first to verify decoding actually works
    const testBatch = finalSamples.slice(0, Math.min(5, finalSamples.length));
    for (const sample of testBatch) {
      decoder.decode(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: Math.round((sample.cts ?? sample.dts) / timescale * 1_000_000),
        duration: Math.round(sample.duration / timescale * 1_000_000),
        data: sample.data!,
      }));
      chunksQueued++;
    }

    // Wait up to 3s for the test batch to produce at least one frame
    const testStart = performance.now();
    while (decodedCount === 0 && !decodeError && performance.now() - testStart < 3000) {
      await new Promise((r) => setTimeout(r, 50));
    }

    if (decodeError) {
      try { decoder.close(); } catch {}
      for (const f of pendingFrames.values()) f.close();
      throw new Error(`Decode failed on test batch: ${decodeError}`);
    }

    if (decodedCount === 0) {
      try { decoder.close(); } catch {}
      for (const f of pendingFrames.values()) f.close();
      throw new Error('Decoder produced 0 frames from test batch — codec may be unsupported');
    }

    console.log('[Demuxer] test batch OK: %d frames from %d chunks', decodedCount, chunksQueued);

    // Now feed the rest
    const remaining = finalSamples.slice(testBatch.length);
    for (const sample of remaining) {
      if (this.closed || decodeError) break;

      decoder.decode(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: Math.round((sample.cts ?? sample.dts) / timescale * 1_000_000),
        duration: Math.round(sample.duration / timescale * 1_000_000),
        data: sample.data!,
      }));
      chunksQueued++;

      if (decoder.decodeQueueSize > 15) {
        await withTimeout(
          new Promise<void>((r) => {
            const check = () => {
              if (decoder.decodeQueueSize <= 5 || decodeError || decoder.state === 'closed') r();
              else setTimeout(check, 5);
            };
            check();
          }),
          10_000,
          'backpressure drain',
        );
        if (decodeError) break;
      }
    }

    if (decodeError) {
      try { decoder.close(); } catch {}
      for (const f of pendingFrames.values()) f.close();
      throw new Error(`Decode error: ${decodeError}`);
    }

    console.log('[Demuxer] queued %d chunks, %d decoded, flushing…', chunksQueued, decodedCount);

    try {
      await withTimeout(decoder.flush(), 30_000, 'decoder.flush()');
    } catch (e) {
      try { decoder.close(); } catch {}
      for (const f of pendingFrames.values()) f.close();
      throw e;
    }
    decoder.close();

    console.log('[Demuxer] flush done: %d total frames, converting to bitmaps…', decodedCount);

    for (const [timestamp, frame] of pendingFrames) {
      const timeInSeconds = timestamp / 1_000_000;
      const roundedTime = Math.round(timeInSeconds * fps) / fps;
      try {
        const bitmap = await createImageBitmap(frame);
        this.frameCache.set(roundedTime, bitmap);
      } catch {}
      frame.close();
    }
    pendingFrames.clear();

    console.log('[Demuxer] done: %d bitmaps cached', this.frameCache.size);
    onProgress?.(totalSamples, totalSamples);
  }

  getFrameAt(timeInSeconds: number): CanvasImageSource | null {
    if (this.frameCache.size === 0) return null;

    let bestKey = -1;
    let bestDist = Infinity;
    for (const key of this.frameCache.keys()) {
      const dist = Math.abs(key - timeInSeconds);
      if (dist < bestDist) { bestDist = dist; bestKey = key; }
    }
    if (bestKey >= 0 && bestDist < 0.5) return this.frameCache.get(bestKey) ?? null;
    return null;
  }

  get sampleCount(): number { return this.samples.length; }
  get codecString(): string { return this.decoderConfig?.codec ?? 'unknown'; }
  get isReady(): boolean { return this.decoderConfig !== null && this.samples.length > 0; }

  releaseFramesBefore(timeInSeconds: number): void {
    for (const [key, bmp] of this.frameCache) {
      if (key < timeInSeconds - 0.1) {
        bmp.close();
        this.frameCache.delete(key);
      }
    }
  }

  close(): void {
    this.closed = true;
    for (const bmp of this.frameCache.values()) bmp.close();
    this.frameCache.clear();
    this.mp4File = null;
    this.samples = [];
  }
}

export class VideoElementFrameProvider implements FrameProvider {
  constructor(private el: HTMLVideoElement) {}

  getFrameAt(_timeInSeconds: number): CanvasImageSource | null {
    if (this.el.readyState >= 2) return this.el;
    if (this.el.readyState >= 1 && this.el.videoWidth > 0) return this.el;
    return null;
  }
}
