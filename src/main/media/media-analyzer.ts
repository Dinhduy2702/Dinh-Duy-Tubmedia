import { stat } from 'node:fs/promises';
import { ToolNotFoundError, VerificationFailedError } from '@shared/errors/app-errors.js';
import type { MediaInfo } from '@shared/types/domain.js';
import type { ProcessManager } from '../processes/process-manager.js';
import type { ToolManager } from '../tools/tool-manager.js';

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(stringValue(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ratio(value: unknown): number {
  const text = stringValue(value);
  if (!text) return 0;
  const [numerator = 0, denominator = 0] = text.split('/').map(Number);
  if (denominator) return numerator / denominator;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveDuration(value: unknown): number | null {
  const parsed = numberValue(value, 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function durationFromTimeBase(stream: Record<string, unknown> | undefined): number | null {
  if (!stream) return null;
  const durationTs = positiveDuration(stream.duration_ts);
  const timeBase = ratio(stream.time_base);
  if (durationTs === null || !Number.isFinite(timeBase) || timeBase <= 0) return null;
  const duration = durationTs * timeBase;
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

/**
 * MP4 files created by stream-copy can occasionally contain a wildly inflated
 * container duration while the video stream duration is still sane. Prefer the
 * video timeline when the container differs by an impossible amount so progress
 * and verification do not seek days beyond the real end of the file.
 */
export function selectMediaDuration(
  format: Record<string, unknown> | undefined,
  video: Record<string, unknown>,
  audio: Record<string, unknown> | undefined
): number {
  const formatDuration = positiveDuration(format?.duration);
  const videoDuration = positiveDuration(video.duration) ?? durationFromTimeBase(video);
  const audioDuration = positiveDuration(audio?.duration) ?? durationFromTimeBase(audio);

  if (videoDuration !== null && formatDuration !== null) {
    const excessiveContainerDuration = formatDuration > Math.max(
      videoDuration * 4,
      videoDuration + 300
    );
    if (excessiveContainerDuration) return videoDuration;

    const closeAudioDuration = audioDuration !== null &&
      audioDuration <= Math.max(videoDuration * 1.25, videoDuration + 30)
      ? audioDuration
      : null;
    return Math.max(videoDuration, closeAudioDuration ?? 0, formatDuration);
  }

  return videoDuration ?? formatDuration ?? audioDuration ?? 0;
}

interface CachedMediaInfo {
  fingerprint: string;
  info: MediaInfo;
  lastUsedAt: number;
}

/**
 * ffprobe is relatively cheap compared with transcoding, but the merge pipeline
 * used to probe the same file several times (planning, verification, timeline,
 * size validation). This cache is keyed by a stable filesystem fingerprint so
 * a rename from *.pending.mp4 to the final file can reuse the same analysis.
 */
export class MediaAnalyzer {
  private readonly cacheByPath = new Map<string, CachedMediaInfo>();
  private readonly cacheByFingerprint = new Map<string, CachedMediaInfo>();
  private readonly maxCacheEntries = 512;

  public constructor(
    private readonly processes: ProcessManager,
    private readonly tools: ToolManager
  ) {}

  public async analyze(path: string, jobId = 'manual-analyze'): Promise<MediaInfo> {
    const file = await stat(path);
    const fingerprint = [
      String(file.dev),
      String(file.ino),
      String(file.size),
      String(Math.round(file.mtimeMs)),
      String(Math.round(file.birthtimeMs))
    ].join(':');

    const cachedByPath = this.cacheByPath.get(path);
    if (cachedByPath?.fingerprint === fingerprint) {
      cachedByPath.lastUsedAt = Date.now();
      return cachedByPath.info;
    }

    const cachedByFingerprint = this.cacheByFingerprint.get(fingerprint);
    if (cachedByFingerprint) {
      const reused: CachedMediaInfo = {
        fingerprint,
        info: cachedByFingerprint.info,
        lastUsedAt: Date.now()
      };
      this.cacheByPath.set(path, reused);
      this.pruneCache();
      return reused.info;
    }

    const tool = this.tools.get('ffprobe');
    if (!tool.available || !tool.executablePath) throw new ToolNotFoundError('ffprobe');

    const result = await this.processes.run({
      jobId,
      tool: 'ffprobe',
      executablePath: tool.executablePath,
      args: ['-v', 'error', '-show_streams', '-show_format', '-of', 'json=compact=1', path],
      timeoutMs: 120_000
    });
    if (result.code !== 0) {
      throw new VerificationFailedError(result.stderrTail || 'ffprobe thất bại.');
    }

    let data: {
      streams?: Array<Record<string, unknown>>;
      format?: Record<string, unknown>;
    };
    try {
      data = JSON.parse(result.stdoutTail) as typeof data;
    } catch {
      throw new VerificationFailedError('ffprobe trả JSON không hợp lệ.');
    }

    const video = data.streams?.find((stream) => stream.codec_type === 'video');
    if (!video) throw new VerificationFailedError('Tệp không có luồng video.');
    const audio = data.streams?.find((stream) => stream.codec_type === 'audio');

    const duration = selectMediaDuration(data.format, video, audio);
    if (duration <= 0) throw new VerificationFailedError('Duration không hợp lệ.');

    const transfer = stringValue(video.color_transfer).toLowerCase();
    const primaries = stringValue(video.color_primaries).toLowerCase();
    const colorSpace = stringValue(video.color_space).toLowerCase();
    const colorRange = stringValue(video.color_range).toLowerCase();
    const pixelFormat = stringValue(video.pix_fmt, 'unknown');
    const inferredBits = /p10|10le/i.test(pixelFormat) ? 10 : 8;
    const bitDepth = numberValue(video.bits_per_raw_sample, inferredBits);
    const tags = video.tags && typeof video.tags === 'object'
      ? video.tags as Record<string, unknown>
      : {};
    const sideData = Array.isArray(video.side_data_list)
      ? video.side_data_list.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
      : [];
    const rawRotation = numberValue(
      tags.rotate,
      numberValue(sideData.find((entry) => entry.rotation !== undefined)?.rotation, 0)
    );
    const rotation = ((Math.round(rawRotation) % 360) + 360) % 360;
    const codedWidth = numberValue(video.width);
    const codedHeight = numberValue(video.height);
    const rotated = rotation === 90 || rotation === 270;
    const nominalFps = ratio(video.r_frame_rate);
    const averageFps = ratio(video.avg_frame_rate);
    const fps = averageFps > 0 ? averageFps : nominalFps;
    const variableFrameRate = averageFps > 0 && nominalFps > 0 && Math.abs(averageFps - nominalFps) >= 0.01;
    const sideDataTypes = sideData.map((entry) => stringValue(entry.side_data_type).toLowerCase());
    const masteringDisplayMetadata = sideDataTypes.some((value) => value.includes('mastering display'));
    const dolbyVision = sideDataTypes.some((value) => value.includes('dovi') || value.includes('dolby vision'));
    const pq = transfer.includes('smpte2084');
    const hlg = transfer.includes('arib-std-b67');
    const hdr = dolbyVision || pq || hlg || masteringDisplayMetadata;
    const hdrType = dolbyVision ? 'dolby_vision' : hlg ? 'hlg' : pq ? 'hdr10' : hdr ? 'unknown' : null;
    const streamStartTime = video.start_time === undefined ? null : numberValue(video.start_time);
    const totalBitrate = data.format?.bit_rate === undefined
      ? null
      : numberValue(data.format.bit_rate);
    const audioBitrate = audio?.bit_rate === undefined
      ? null
      : numberValue(audio.bit_rate);
    const videoBitrate = video.bit_rate === undefined
      ? totalBitrate !== null
        ? Math.max(0, totalBitrate - (audioBitrate ?? 0))
        : null
      : numberValue(video.bit_rate);

    const info: MediaInfo = {
      duration,
      width: rotated ? codedHeight : codedWidth,
      height: rotated ? codedWidth : codedHeight,
      fps,
      videoCodec: stringValue(video.codec_name, 'unknown'),
      videoProfile: stringValue(video.profile) || null,
      videoLevel: stringValue(video.level) || null,
      pixelFormat,
      bitDepth: bitDepth > 0 ? bitDepth : null,
      timeBase: stringValue(video.time_base) || null,
      nominalFps: nominalFps > 0 ? nominalFps : null,
      variableFrameRate,
      sampleAspectRatio: stringValue(video.sample_aspect_ratio) || null,
      displayAspectRatio: stringValue(video.display_aspect_ratio) || null,
      rotation,
      streamStartTime,
      timestampCondition: streamStartTime === null ? 'unknown' : streamStartTime < -0.001 ? 'negative_start' : 'normal',
      colorPrimaries: primaries || null,
      colorTransfer: transfer || null,
      colorSpace: colorSpace || null,
      colorRange: colorRange || null,
      hdr,
      hdrType,
      masteringDisplayMetadata,
      audioCodec: stringValue(audio?.codec_name) || null,
      videoBitrate,
      audioBitrate,
      sampleRate: audio?.sample_rate === undefined ? null : numberValue(audio.sample_rate),
      channels: audio?.channels === undefined ? null : numberValue(audio.channels),
      channelLayout: stringValue(audio?.channel_layout) || null,
      formatName: stringValue(data.format?.format_name) || null,
      fileSize: file.size
    };

    const entry: CachedMediaInfo = {
      fingerprint,
      info,
      lastUsedAt: Date.now()
    };
    this.cacheByPath.set(path, entry);
    this.cacheByFingerprint.set(fingerprint, entry);
    this.pruneCache();
    return info;
  }

  public forget(path: string): void {
    this.cacheByPath.delete(path);
  }

  private pruneCache(): void {
    if (this.cacheByPath.size <= this.maxCacheEntries) return;
    const oldest = [...this.cacheByPath.entries()]
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
      .slice(0, this.cacheByPath.size - this.maxCacheEntries);
    for (const [path] of oldest) this.cacheByPath.delete(path);

    const activeFingerprints = new Set(
      [...this.cacheByPath.values()].map((entry) => entry.fingerprint)
    );
    for (const key of this.cacheByFingerprint.keys()) {
      if (!activeFingerprints.has(key)) this.cacheByFingerprint.delete(key);
    }
  }
}
