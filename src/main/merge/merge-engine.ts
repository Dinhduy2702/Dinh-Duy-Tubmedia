import {
  sanitizeNonNegativeNumber,
  sanitizeNullableSeconds,
  sanitizeProgress
} from '@shared/utils/progress-policy.js';
import { access, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type {
  MediaInfo,
  QualityProfile,
  QueueJob,
  ResourceProfile,
  TimelineRow
} from '@shared/types/domain.js';
import { compareForConcat } from '@shared/utils/concat-compatibility.js';
import { matchNormalizationTarget } from '@shared/utils/normalization-match.js';
import { sanitizeFilename } from '@shared/utils/filename.js';
import { chooseMergeTarget, validateMergeOutputSize } from '@shared/utils/merge-target.js';
import { FfmpegProgressTracker } from '@shared/utils/ffmpeg-progress.js';
import { formatTimelineLine } from '@shared/utils/timestamp.js';
import { MergeFailedError, ToolNotFoundError } from '@shared/errors/app-errors.js';
import type { ToolManager } from '../tools/tool-manager.js';
import type { ProcessManager, ProcessResult } from '../processes/process-manager.js';
import type { MediaAnalyzer } from '../media/media-analyzer.js';
import { classifyShortVisualBoundaryTransition, isVisualIssueNearBoundary } from '../media/file-verifier.js';
import type {
  FileVerifier,
  VerificationOptions,
  VerificationResult,
  VisualIntegrityIssue,
  VisualIntegrityResult
} from '../media/file-verifier.js';
import type { NormalizeEngine, NormalizeTarget } from '../normalize/normalize-engine.js';
import type { TimelineArtifact, TimelineService } from './timeline-service.js';
import type { QuarantineService } from '../media/quarantine-service.js';
import { ensureDirectory } from '../files/ensure-directory.js';
import { ensureTubmediaOwnedDirectory } from '../files/file-ownership.js';
import { commitFileWithoutOverwrite } from '../files/non-conflicting-path.js';

export interface MergeInput {
  path: string;
  label: string;
  note: string;
  sourcePath?: string;
  sourceStartSeconds?: number | null;
  sourceEndSeconds?: number | null;
  sourceAudioMode?: string;
  recoveryIdentity?: string;
}

/* TUBMEDIA VERIFIED MERGE RECOVERY HOTFIX12 */
export interface MergeRecoveryOptions {
  trustedOutputPath?: string | null;
  legacyPendingPaths?: string[];
}

export type MergeRecoveryMode = 'new-merge' | 'verified-final' | 'verified-checkpoint';

/* TUBMEDIA TIMELINE ONLY ENGINE HOTFIX12 */
export interface TimelineOnlyInput extends MergeInput {
  sourceStartSeconds: number | null;
  sourceEndSeconds: number | null;
}

export interface MergeProgress {
  percent: number;
  stage: string;
  speed: string | null;
  etaSeconds: number | null;
  elapsedSeconds: number;
  processedSeconds: number;
  totalSeconds: number;
  currentItem: number;
  itemCount: number;
}

export interface MergeResult {
  video: string;
  timeline: {
    txt: string | null;
    totalDuration: number;
    itemCount: number;
    rows: TimelineRow[];
  };
  warnings: string[];
  recoveryMode: MergeRecoveryMode;
  reusedExisting: boolean;
  visualBoundaryTransitions: Array<{
    classification: 'boundary-transition';
    type: 'black' | 'freeze';
    outputTimeSeconds: number;
    outputTime: string;
    boundarySeconds: number;
    boundaryTime: string;
    boundaryAfterSourceIndex: number;
    durationSeconds: number;
    distanceSeconds: number;
  }>;
}

interface PreparedInput extends MergeInput {
  info: MediaInfo;
}

/* TUBMEDIA VERIFIED MERGE RECOVERY HOTFIX12 */
interface MergeCheckpointReceipt {
  version: 1;
  signature: string;
  outputPath: string;
  expectedDuration: number;
  createdAt: string;
}

interface ReusableMergeCandidateValidation {
  ok: boolean;
  reasons: string[];
  warnings: string[];
  boundaryTransitions: VisualBoundaryTransitionEvidence[];
}

export type MergeRecoveryCandidateKind = 'final' | 'checkpoint';
export type MergeRecoveryDecision =
  | { action: 'reuse-final'; mode: 'verified-final'; quarantineCheckpoint: false }
  | { action: 'commit-checkpoint'; mode: 'verified-checkpoint'; quarantineCheckpoint: false }
  | { action: 'rebuild'; mode: 'new-merge'; quarantineCheckpoint: boolean };

/**
 * NTFS giới hạn 255 đơn vị UTF-16 cho MỘT thành phần đường dẫn. Tệp checkpoint có tên
 * "<tên>.<chữ ký 24 ký tự>.pending.mp4" (thêm 37 ký tự) nên tên thành phẩm dài 219–220 ký tự
 * (mức tối đa giao diện cho phép) làm ffmpeg không mở được tệp. Chỉ phần tên dùng cho tệp
 * checkpoint bị rút ngắn; tên thành phẩm cuối cùng giữ nguyên.
 */
export const MAX_CHECKPOINT_STEM_LENGTH = 150;

export function checkpointFileStem(safeName: string): string {
  if (safeName.length <= MAX_CHECKPOINT_STEM_LENGTH) return safeName;
  let stem = safeName.slice(0, MAX_CHECKPOINT_STEM_LENGTH);
  const last = stem.charCodeAt(stem.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) stem = stem.slice(0, -1); // không cắt đôi cặp ký tự thay thế (emoji)
  return stem.replace(/[. ]+$/g, '') || 'Thành phẩm';
}

export function decideMergeRecoveryCandidate(
  kind: MergeRecoveryCandidateKind,
  verificationOk: boolean
): MergeRecoveryDecision {
  if (verificationOk && kind === 'final') {
    return { action: 'reuse-final', mode: 'verified-final', quarantineCheckpoint: false };
  }
  if (verificationOk) {
    return { action: 'commit-checkpoint', mode: 'verified-checkpoint', quarantineCheckpoint: false };
  }
  return {
    action: 'rebuild',
    mode: 'new-merge',
    quarantineCheckpoint: kind === 'checkpoint'
  };
}

function recoveryPathKey(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function sampledFileFingerprint(filePath: string, fileSize: number): Promise<string> {
  const chunkSize = 64 * 1024;
  const offsets = [
    ...new Set([
      0,
      Math.max(0, Math.floor(fileSize / 2) - Math.floor(chunkSize / 2)),
      Math.max(0, fileSize - chunkSize)
    ])
  ];
  const hash = createHash('sha256').update(String(fileSize), 'utf8');
  const handle = await open(filePath, 'r');
  try {
    for (const offset of offsets) {
      const length = Math.min(chunkSize, Math.max(0, fileSize - offset));
      if (length <= 0) continue;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      hash.update(String(offset), 'utf8');
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      result[index] = await worker(values[index]!, index);
    }
  });
  await Promise.all(runners);
  return result;
}

/* TUBMEDIA TIMELINE ONLY ENGINE HOTFIX12 */
export function buildTimelineOnlyArtifact(
  inputs: readonly TimelineOnlyInput[],
  sourceDurations: readonly number[]
): TimelineArtifact {
  if (inputs.length === 0) throw new MergeFailedError('Không có video hợp lệ để tạo timeline.');
  if (inputs.length !== sourceDurations.length)
    throw new MergeFailedError('Dữ liệu thời lượng timeline không đồng bộ.');

  let cursor = 0;
  const rows: TimelineRow[] = inputs.map((input, index) => {
    const rawDuration = sourceDurations[index] ?? 0;
    const sourceDuration = Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 0;
    const requestedStart = input.sourceStartSeconds ?? 0;
    const sourceStart = Math.min(
      sourceDuration,
      Math.max(0, Number.isFinite(requestedStart) ? requestedStart : 0)
    );
    const requestedEnd = input.sourceEndSeconds;
    const sourceEnd =
      requestedEnd === null
        ? sourceDuration
        : Math.min(sourceDuration, Math.max(0, Number.isFinite(requestedEnd) ? requestedEnd : 0));
    const duration = Math.max(0, sourceEnd - sourceStart);
    if (duration <= 0) {
      throw new MergeFailedError(
        'Video #' + (index + 1) + ' không còn thời lượng hợp lệ sau khi áp dụng mốc bắt đầu/kết thúc.'
      );
    }
    const start = cursor;
    cursor += duration;
    return {
      index: index + 1,
      start,
      end: cursor,
      duration,
      code: formatTimelineLine(start, index + 1),
      label: input.label,
      note: input.note,
      file: input.path
    };
  });
  return { txt: null, totalDuration: cursor, itemCount: rows.length, rows };
}
function escapeConcatPath(path: string): string {
  return path.replaceAll('\\', '/').replaceAll("'", "'\\''");
}

/* TUBMEDIA MERGE OUTPUT HARDENING R33 */
function mergeClock(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
}

function mergeBoundaries(prepared: readonly PreparedInput[]): number[] {
  const boundaries: number[] = [];
  let cursor = 0;
  for (let index = 0; index < prepared.length - 1; index += 1) {
    cursor += Math.max(0, prepared[index]?.info.duration ?? 0);
    boundaries.push(cursor);
  }
  return boundaries;
}

function locateVisualIssue(
  prepared: readonly PreparedInput[],
  seconds: number
): { index: number; item: PreparedInput } | null {
  let cursor = 0;
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index];
    if (!item) continue;
    const end = cursor + Math.max(0, item.info.duration);
    if (seconds <= end || index === prepared.length - 1) return { index, item };
    cursor = end;
  }
  return null;
}

export interface VisualSourceSegment {
  index: number;
  localStartSeconds: number;
  localEndSeconds: number;
}

/* TUBMEDIA SOURCE-AWARE VISUAL MAPPING R38 */
export function mapVisualIssueToSourceSegments(
  issue: Pick<VisualIntegrityIssue, 'startSeconds' | 'endSeconds' | 'durationSeconds'>,
  durations: readonly number[],
  paddingSeconds = 2.5
): VisualSourceSegment[] {
  const issueEnd = Math.max(
    issue.startSeconds,
    issue.endSeconds ?? issue.startSeconds + Math.max(0, issue.durationSeconds ?? 0)
  );
  const expandedStart = Math.max(0, issue.startSeconds - Math.max(0, paddingSeconds));
  const expandedEnd = issueEnd + Math.max(0, paddingSeconds);
  const result: VisualSourceSegment[] = [];
  let cursor = 0;
  for (let index = 0; index < durations.length; index += 1) {
    const duration = Math.max(0, durations[index] ?? 0);
    const sourceStart = cursor;
    const sourceEnd = sourceStart + duration;
    if (expandedEnd >= sourceStart && expandedStart <= sourceEnd) {
      const localStartSeconds =
        issue.startSeconds < sourceStart
          ? 0
          : issue.startSeconds > sourceEnd
            ? duration
            : Math.max(0, issue.startSeconds - sourceStart);
      const localEndSeconds =
        issueEnd < sourceStart
          ? 0
          : issueEnd > sourceEnd
            ? duration
            : Math.max(localStartSeconds, issueEnd - sourceStart);
      result.push({ index, localStartSeconds, localEndSeconds });
    }
    cursor = sourceEnd;
  }
  return result;
}

/* TUBMEDIA STRICT VISUAL BOUNDARY POLICY HOTFIX11 */
export interface VisualBoundaryTransitionEvidence {
  issue: VisualIntegrityIssue & { type: 'black' | 'freeze' };
  classification: 'boundary-transition';
  boundaryIndex: number;
  boundarySeconds: number;
  durationSeconds: number;
  distanceSeconds: number;
}

export function applyShortVisualBoundaryPolicy(
  integrity: VisualIntegrityResult,
  boundaries: readonly number[]
): { integrity: VisualIntegrityResult; accepted: VisualBoundaryTransitionEvidence[] } {
  const accepted: VisualBoundaryTransitionEvidence[] = [];
  /* TUBMEDIA VISUAL BOUNDARY TYPE GUARD HOTFIX11R3 */
  function isBoundaryTransitionVisualIssue(
    issue: VisualIntegrityIssue
  ): issue is VisualIntegrityIssue & { type: 'black' | 'freeze' } {
    return issue.type === 'black' || issue.type === 'freeze';
  }

  for (const issue of integrity.issues) {
    if (!isBoundaryTransitionVisualIssue(issue)) continue;
    const transition = classifyShortVisualBoundaryTransition(issue, boundaries);
    if (transition) accepted.push({ issue, ...transition });
  }
  if (accepted.length === 0) return { integrity, accepted };

  const acceptedIssues = new Set<VisualIntegrityIssue>(accepted.map((entry) => entry.issue));
  const blockingIssues = integrity.issues.filter((issue) => !acceptedIssues.has(issue));
  return {
    integrity: {
      ok: blockingIssues.length === 0,
      reasons: blockingIssues.map((issue) => issue.message),
      issues: blockingIssues
    },
    accepted
  };
}

function visualBoundaryTransitionWarning(evidence: VisualBoundaryTransitionEvidence): string {
  const kind = evidence.issue.type === 'black' ? 'chuyển cảnh đen' : 'hình đứng chuyển tiếp';
  const duration = evidence.durationSeconds.toFixed(2).replace('.', ',');
  return (
    'Đã ghép an toàn: Tubmedia nhận diện ' +
    kind +
    ' rất ngắn (' +
    duration +
    ' giây) đúng tại điểm nối ' +
    mergeClock(evidence.boundarySeconds) +
    ' giữa nguồn #' +
    (evidence.boundaryIndex + 1) +
    ' và nguồn #' +
    (evidence.boundaryIndex + 2) +
    '. Đây là chuyển cảnh ranh giới, không phải lỗi hỏng hình; thành phẩm vẫn được hậu kiểm đầy đủ trước khi xuất.'
  );
}

/* TUBMEDIA PROVEN FAST PATH R35 */
function differs(reference: MediaInfo, candidate: MediaInfo, keys: Array<keyof MediaInfo>): boolean {
  return keys.some((key) => (reference[key] ?? null) !== (candidate[key] ?? null));
}

function hasVideoBitstreamMismatch(reference: MediaInfo, candidate: MediaInfo): boolean {
  return differs(reference, candidate, [
    'videoProfile',
    'videoLevel',
    'bitDepth',
    'nominalFps',
    'videoExtradataHash',
    'colorPrimaries',
    'colorTransfer',
    'colorSpace',
    'colorRange'
  ]);
}

function hasAudioBitstreamMismatch(reference: MediaInfo, candidate: MediaInfo): boolean {
  return differs(reference, candidate, ['audioExtradataHash', 'channelLayout']);
}

function hasTimeBaseMismatch(reference: MediaInfo, candidate: MediaInfo): boolean {
  return (reference.timeBase ?? null) !== (candidate.timeBase ?? null);
}

export class MergeEngine {
  public constructor(
    private readonly tools: ToolManager,
    private readonly processes: ProcessManager,
    private readonly analyzer: MediaAnalyzer,
    private readonly verifier: FileVerifier,
    private readonly normalizer: NormalizeEngine,
    private readonly timeline: TimelineService,
    private readonly quarantine: QuarantineService
  ) {}

  /* TUBMEDIA TIMELINE ONLY ENGINE HOTFIX12 */
  /* TUBMEDIA VERIFIED MERGE RECOVERY HOTFIX12 */
  private async createMergeCheckpointSignature(
    inputs: readonly MergeInput[],
    profile: QualityProfile,
    targetPath: string
  ): Promise<string> {
    const sourceFacts = await Promise.all(
      inputs.map(async (input, index) => {
        const sourcePath = input.sourcePath ?? input.path;
        const file = await stat(sourcePath);
        const contentSample = await sampledFileFingerprint(sourcePath, file.size);
        const privateIdentity = createHash('sha256')
          .update(input.recoveryIdentity ?? 'path:' + sourcePath, 'utf8')
          .digest('hex');
        return [
          index,
          privateIdentity,
          file.size,
          Math.round(file.mtimeMs),
          contentSample,
          input.sourceStartSeconds ?? null,
          input.sourceEndSeconds ?? null,
          input.sourceAudioMode ?? 'default'
        ];
      })
    );
    const profileFacts = [
      profile.id,
      profile.mode,
      profile.maxWidth,
      profile.maxHeight,
      profile.allowUpscale,
      profile.fpsMode,
      profile.customFps,
      profile.videoCodec,
      profile.encoder,
      profile.crf,
      profile.cq,
      profile.bitrateMode ?? null,
      profile.preset,
      profile.pixelFormat,
      profile.hdrMode,
      profile.audioMode,
      profile.sampleRate,
      profile.forceStereo
    ];
    return createHash('sha256')
      .update(
        JSON.stringify({ version: 1, sourceFacts, profileFacts, targetPath: recoveryPathKey(targetPath) }),
        'utf8'
      )
      .digest('hex')
      .slice(0, 24);
  }

  private async readMergeCheckpointReceipt(receiptPath: string, signature: string): Promise<string | null> {
    try {
      const parsed = JSON.parse(await readFile(receiptPath, 'utf8')) as Partial<MergeCheckpointReceipt>;
      if (parsed.version !== 1 || parsed.signature !== signature || typeof parsed.outputPath !== 'string') {
        return null;
      }
      await access(parsed.outputPath, constants.R_OK);
      return parsed.outputPath;
    } catch {
      return null;
    }
  }

  private async writeMergeCheckpointReceipt(
    receiptPath: string,
    signature: string,
    outputPath: string,
    expectedDuration: number
  ): Promise<void> {
    const receipt: MergeCheckpointReceipt = {
      version: 1,
      signature,
      outputPath,
      expectedDuration,
      createdAt: new Date().toISOString()
    };
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  }

  private async timelineForRecoveredMerge(
    prepared: readonly PreparedInput[],
    outputFolder: string,
    safeName: string,
    exportTimelineTxt: boolean
  ): Promise<{ timeline: TimelineArtifact; warnings: string[] }> {
    const warnings: string[] = [];
    const timelineInputs = prepared.map((item) => ({
      path: item.path,
      label: item.label,
      note: item.note
    }));
    try {
      return {
        timeline: await this.timeline.write(timelineInputs, outputFolder, safeName, exportTimelineTxt),
        warnings
      };
    } catch (error) {
      warnings.push(
        'Video hợp lệ đã được dùng lại nhưng không thể tạo hoặc ghi timeline TXT: ' + String(error)
      );
      let cursor = 0;
      const rows: TimelineRow[] = prepared.map((item, index) => {
        const start = cursor;
        cursor += item.info.duration;
        return {
          index: index + 1,
          start,
          end: cursor,
          duration: item.info.duration,
          code: formatTimelineLine(start, index + 1),
          label: item.label,
          note: item.note,
          file: item.path
        };
      });
      return { timeline: { txt: null, totalDuration: cursor, itemCount: rows.length, rows }, warnings };
    }
  }

  private async validateReusableMergeCandidate(
    candidate: string,
    prepared: readonly PreparedInput[],
    visualReferences: readonly PreparedInput[],
    inputInfos: readonly MediaInfo[],
    expectedDuration: number,
    expectedAudio: boolean,
    profile: QualityProfile,
    job: QueueJob,
    signal: AbortSignal,
    onVisualProgress: (percent: number) => void
  ): Promise<ReusableMergeCandidateValidation> {
    const options: VerificationOptions = {
      jobId: job.id + '-recovery',
      projectId: job.projectId,
      signal,
      expectedStreams: { video: true, audio: expectedAudio }
    };
    this.analyzer.forget(candidate);
    const check = await this.verifyPendingTwice(candidate, expectedDuration, options);
    if (signal.aborted) throw new MergeFailedError('Đã hủy xác minh checkpoint ghép.');
    if (!check.ok) {
      return { ok: false, reasons: check.reasons, warnings: [], boundaryTransitions: [] };
    }

    const boundaries = mergeBoundaries(prepared);
    let integrity = await this.verifier.verifyVisualIntegrity(candidate, expectedDuration, boundaries, {
      ...options,
      onProgress: onVisualProgress
    });
    if (signal.aborted) throw new MergeFailedError('Đã hủy xác minh checkpoint ghép.');
    let sourceOriginEvidence: Array<{
      issue: VisualIntegrityIssue;
      sourceIndex: number;
      sourcePath: string;
      sourceLocalTimeSeconds: number;
    }> = [];
    ({ integrity, sourceOriginEvidence } = await this.reconcileVisualIssuesWithOriginalSources(
      integrity,
      visualReferences,
      job,
      signal
    ));
    const warnings: string[] = sourceOriginEvidence.map((evidence) => {
      const reference = visualReferences[evidence.sourceIndex]!;
      const kind = evidence.issue.type === 'black' ? 'đoạn hình đen/chuyển cảnh' : 'đoạn hình đứng';
      return (
        'Nguồn #' +
        (evidence.sourceIndex + 1) +
        ' – ' +
        (reference.label || reference.path) +
        ' có sẵn ' +
        kind +
        ' quanh ' +
        mergeClock(evidence.issue.startSeconds) +
        ' (trong nguồn khoảng ' +
        mergeClock(evidence.sourceLocalTimeSeconds) +
        ').'
      );
    });
    const policy = applyShortVisualBoundaryPolicy(integrity, boundaries);
    integrity = policy.integrity;
    warnings.push(...policy.accepted.map(visualBoundaryTransitionWarning));
    if (!integrity.ok) {
      return { ok: false, reasons: integrity.reasons, warnings, boundaryTransitions: policy.accepted };
    }

    const candidateInfo = await this.analyzer.analyze(candidate, job.id + '-recovery-info');
    if (expectedAudio) {
      const videoDuration = candidateInfo.videoStreamDuration ?? candidateInfo.duration;
      const audioDuration = candidateInfo.audioStreamDuration;
      if (audioDuration === null || audioDuration === undefined) {
        return {
          ok: false,
          reasons: ['Thành phẩm thiếu audio stream.'],
          warnings,
          boundaryTransitions: policy.accepted
        };
      }
      const avDrift = Math.abs(videoDuration - audioDuration);
      const tolerance = Math.max(1.25, Math.min(4, expectedDuration * 0.0015));
      if (avDrift > tolerance) {
        return {
          ok: false,
          reasons: ['Âm thanh và hình ảnh lệch ' + avDrift.toFixed(2) + ' giây.'],
          warnings,
          boundaryTransitions: policy.accepted
        };
      }
    }
    const sizeValidation = validateMergeOutputSize([...inputInfos], candidateInfo.fileSize, profile);
    if (!sizeValidation.ok) {
      return {
        ok: false,
        reasons: [sizeValidation.message ?? 'Dung lượng thành phẩm thấp bất thường.'],
        warnings,
        boundaryTransitions: policy.accepted
      };
    }
    return { ok: true, reasons: [], warnings, boundaryTransitions: policy.accepted };
  }
  /* TUBMEDIA VERIFIED TIMELINE SOURCES HOTFIX12R8 */
  public async createTimelineOnly(
    job: QueueJob,
    inputs: TimelineOnlyInput[],
    resource: ResourceProfile,
    signal: AbortSignal,
    onProgress: (progress: MergeProgress) => void
  ): Promise<TimelineArtifact> {
    if (!inputs.length) throw new MergeFailedError('Không có video hợp lệ để tạo timeline.');
    const startedAt = Date.now();
    const emit = (
      percent: number,
      stage: string,
      currentItem = 0,
      totalSeconds = 0,
      processedSeconds = 0
    ): void => {
      onProgress({
        percent: sanitizeProgress(percent),
        stage,
        speed: null,
        etaSeconds: null,
        elapsedSeconds: sanitizeNonNegativeNumber(Math.floor((Date.now() - startedAt) / 1000)),
        processedSeconds,
        totalSeconds,
        currentItem,
        itemCount: inputs.length
      });
    };

    emit(2, 'Đang kiểm tra danh sách video nguồn; không ghép và không tạo MP4');
    let analyzed = 0;
    const analyzeConcurrency = Math.max(1, Math.min(resource.analyzeWorkers, inputs.length));
    const infos = await mapLimit(inputs, analyzeConcurrency, async (input, index) => {
      if (signal.aborted) throw new MergeFailedError('Đã hủy tạo timeline.');
      let info: MediaInfo;
      try {
        info = await this.analyzer.analyze(input.path, job.id + '-timeline-analyze-' + (index + 1));
      } catch (error) {
        throw new MergeFailedError(
          'Không đọc được video nguồn #' +
            (index + 1) +
            ' – ' +
            input.label +
            ': ' +
            (error instanceof Error ? error.message : String(error)),
          { phase: 'timeline-source-analysis', sourceIndex: index + 1, sourcePath: input.path }
        );
      }
      analyzed += 1;
      emit(
        5 + (analyzed / inputs.length) * 15,
        `Đã đọc thông tin nguồn ${analyzed}/${inputs.length}`,
        analyzed
      );
      return info;
    });
    const totalSourceSeconds = infos.reduce((sum, info) => sum + info.duration, 0);
    const verificationProgress = inputs.map(() => 0);
    let verified = 0;
    const verificationConcurrency = Math.max(1, Math.min(resource.normalizeWorkers, 2, inputs.length));
    emit(20, `Kiểm tra giải mã toàn bộ ${inputs.length} video nguồn`, 0, totalSourceSeconds);
    await mapLimit(inputs, verificationConcurrency, async (input, index) => {
      if (signal.aborted) throw new MergeFailedError('Đã hủy tạo timeline.');
      const info = infos[index]!;
      const checked = await this.verifier.verify(input.path, 'deep', info.duration, {
        jobId: job.id + '-timeline-source-' + (index + 1),
        projectId: job.projectId,
        signal,
        expectedStreams: { video: true, audio: info.audioCodec !== null },
        onProgress: (percent) => {
          verificationProgress[index] = Math.max(verificationProgress[index] ?? 0, sanitizeProgress(percent));
          const aggregate = verificationProgress.reduce((sum, value) => sum + value, 0) / inputs.length;
          emit(
            20 + aggregate * 0.75,
            `Đang kiểm tra video nguồn ${index + 1}/${inputs.length} · ${Math.round(percent)}%`,
            Math.min(inputs.length, verified + 1),
            totalSourceSeconds,
            (aggregate / 100) * totalSourceSeconds
          );
        }
      });
      if (!checked.ok) {
        throw new MergeFailedError(
          'Video nguồn #' +
            (index + 1) +
            ' – ' +
            input.label +
            ' không đạt kiểm tra giải mã toàn bộ để tạo timeline: ' +
            (checked.reasons.join('; ') || 'không xác định được nguyên nhân'),
          { phase: 'timeline-source-deep-verification', sourceIndex: index + 1, sourcePath: input.path }
        );
      }
      verificationProgress[index] = 100;
      verified += 1;
      const aggregate = verificationProgress.reduce((sum, value) => sum + value, 0) / inputs.length;
      emit(
        20 + aggregate * 0.75,
        `Đã kiểm tra video nguồn ${verified}/${inputs.length}`,
        verified,
        totalSourceSeconds,
        (aggregate / 100) * totalSourceSeconds
      );
      return true;
    });
    emit(
      97,
      'Đang tính mốc timeline từ các nguồn đã xác minh',
      inputs.length,
      totalSourceSeconds,
      totalSourceSeconds
    );
    const artifact = buildTimelineOnlyArtifact(
      inputs,
      infos.map((info) => info.duration)
    );
    emit(
      100,
      'Timeline đã sẵn sàng để xem và xuất TXT',
      inputs.length,
      artifact.totalDuration,
      artifact.totalDuration
    );
    return artifact;
  }
  public async merge(
    job: QueueJob,
    inputs: MergeInput[],
    outputFolder: string,
    workFolder: string,
    quarantineFolder: string,
    finalFileName: string,
    profile: QualityProfile,
    resource: ResourceProfile,
    signal: AbortSignal,
    exportTimelineTxt: boolean,
    onProgress: (progress: MergeProgress) => void,
    recovery: MergeRecoveryOptions = {}
  ): Promise<MergeResult> {
    if (!inputs.length) throw new MergeFailedError('Không có video hợp lệ để ghép.');
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    const startedAt = Date.now();
    let knownTotalDuration = 0;
    const emit = (
      percent: number,
      stage: string,
      detail: Partial<Omit<MergeProgress, 'percent' | 'stage' | 'elapsedSeconds' | 'itemCount'>> = {}
    ): void => {
      onProgress({
        percent: sanitizeProgress(percent),
        stage,
        speed: detail.speed ?? null,
        etaSeconds: sanitizeNullableSeconds(detail.etaSeconds),
        elapsedSeconds: sanitizeNonNegativeNumber(Math.floor((Date.now() - startedAt) / 1000)),
        processedSeconds: sanitizeNonNegativeNumber(detail.processedSeconds ?? 0),
        totalSeconds: sanitizeNonNegativeNumber(detail.totalSeconds ?? knownTotalDuration),
        currentItem: Math.max(0, Math.floor(sanitizeNonNegativeNumber(detail.currentItem ?? 0))),
        itemCount: inputs.length
      });
    };

    emit(1, 'Khởi tạo luồng ghép thông minh');
    await ensureDirectory(outputFolder);
    await ensureDirectory(workFolder);
    await ensureDirectory(quarantineFolder);

    // Thư mục cache được giữ lại giữa các lần chạy. Cache key phụ thuộc kích thước,
    // mtime và target nên nguồn thay đổi sẽ không bao giờ dùng nhầm tệp cũ.
    const normalizeCacheFolder = join(workFolder, '_normalized-cache');
    const remuxCacheFolder = join(workFolder, '_remux-cache');
    await ensureTubmediaOwnedDirectory(normalizeCacheFolder, 'normalize-cache');
    await ensureTubmediaOwnedDirectory(remuxCacheFolder, 'remux-cache');

    let analyzed = 0;
    const analyzeConcurrency = Math.max(1, Math.min(resource.analyzeWorkers, inputs.length));
    const infos = await mapLimit(inputs, analyzeConcurrency, async (input) => {
      const info = await this.analyzer.analyze(input.path, job.id);
      analyzed += 1;
      emit(2 + (analyzed / inputs.length) * 10, `Phân tích video nguồn ${analyzed}/${inputs.length}`, {
        currentItem: analyzed
      });
      return info;
    });

    knownTotalDuration = infos.reduce((sum, info) => sum + info.duration, 0);
    let prepared: PreparedInput[] = inputs.map((input, index) => ({
      ...input,
      info: infos[index]!
    }));
    // Keep immutable references to the original user/source files. Visual anomalies
    // are compared against these originals, never against normalized/remux cache files.
    const visualReferenceInputs: PreparedInput[] = prepared.map((item) => ({ ...item }));

    emit(14, 'Đối chiếu codec, kích thước, FPS và âm thanh', {
      totalSeconds: knownTotalDuration
    });

    const reference = infos[0]!;
    const mergeTarget: NormalizeTarget = chooseMergeTarget(infos, profile);
    const expectedAudio = mergeTarget.audioCodec !== null;
    const allCompatible = infos.every((info) => compareForConcat(reference, info).compatible);
    const forceUniformVideo = infos.some((info) => hasVideoBitstreamMismatch(reference, info));
    const forceUniformAudio = infos.some((info) => hasAudioBitstreamMismatch(reference, info));
    const canonicalizeTimeBase = infos.some((info) => hasTimeBaseMismatch(reference, info));
    const profileRequiresNormalization = [
      'compatible_1080p',
      'smooth_background',
      'maximum_cpu',
      'custom'
    ].includes(profile.mode);
    const normalizationRequired = !allCompatible || profileRequiresNormalization;

    /* TUBMEDIA VERIFIED MERGE RECOVERY HOTFIX12 */
    const safeName = sanitizeFilename(finalFileName.replace(/\.mp4$/i, ''), 'Thành phẩm');
    const final = join(outputFolder, `${safeName}.mp4`);
    const expectedDuration = prepared.reduce((sum, item) => sum + item.info.duration, 0);
    knownTotalDuration = expectedDuration;
    const checkpointFolder = join(workFolder, 'Tubmedia', 'merge-checkpoints');
    await ensureTubmediaOwnedDirectory(checkpointFolder, 'merge-checkpoints', join(workFolder, 'Tubmedia'));
    const checkpointSignature = await this.createMergeCheckpointSignature(inputs, profile, final);
    const checkpointStem = checkpointFileStem(safeName);
    const pending = join(checkpointFolder, `${checkpointStem}.${checkpointSignature}.pending.mp4`);
    const receiptPath = join(checkpointFolder, `${checkpointStem}.${checkpointSignature}.complete.json`);
    const receiptOutput = await this.readMergeCheckpointReceipt(receiptPath, checkpointSignature);
    const candidates: Array<{ path: string; kind: 'final' | 'checkpoint' }> = [];
    const candidateKeys = new Set<string>();
    const addCandidate = (candidatePath: string | null | undefined, kind: 'final' | 'checkpoint'): void => {
      if (!candidatePath || !candidatePath.trim()) return;
      const key = recoveryPathKey(candidatePath);
      if (candidateKeys.has(key)) return;
      candidateKeys.add(key);
      candidates.push({ path: candidatePath, kind });
    };
    addCandidate(receiptOutput, 'final');
    addCandidate(recovery.trustedOutputPath, 'final');
    addCandidate(pending, 'checkpoint');
    for (const legacyPath of recovery.legacyPendingPaths ?? []) addCandidate(legacyPath, 'checkpoint');

    for (const candidate of candidates) {
      try {
        await access(candidate.path, constants.R_OK);
      } catch {
        continue;
      }
      emit(
        15,
        candidate.kind === 'final'
          ? 'Đã tìm thấy thành phẩm cũ · đang hậu kiểm trước khi bỏ qua ghép'
          : 'Đã tìm thấy checkpoint · đang kiểm tra trước khi tiếp tục',
        { totalSeconds: expectedDuration }
      );
      const validation = await this.validateReusableMergeCandidate(
        candidate.path,
        prepared,
        visualReferenceInputs,
        infos,
        expectedDuration,
        expectedAudio,
        profile,
        job,
        signal,
        (percent) =>
          emit(
            20 + percent * 0.7,
            candidate.kind === 'final'
              ? 'Hậu kiểm toàn bộ thành phẩm cũ 0–100%'
              : 'Hậu kiểm toàn bộ checkpoint 0–100%',
            { processedSeconds: (percent / 100) * expectedDuration, totalSeconds: expectedDuration }
          )
      );
      const recoveryDecision = decideMergeRecoveryCandidate(candidate.kind, validation.ok);
      if (recoveryDecision.action === 'rebuild') {
        // Never delete or quarantine a user-visible final file. Only Tubmedia-owned
        // checkpoints are disposable after they fail the complete verification gate.
        if (recoveryDecision.quarantineCheckpoint) {
          try {
            await this.quarantine.move(
              candidate.path,
              quarantineFolder,
              'Checkpoint không đủ điều kiện tiếp tục: ' + validation.reasons.join('; '),
              job.id
            );
          } catch {
            await rm(candidate.path, { force: true });
          }
        }
        continue;
      }

      const recoveryMode: MergeRecoveryMode = recoveryDecision.mode;
      const recoveredOutput =
        recoveryDecision.action === 'reuse-final'
          ? candidate.path
          : await commitFileWithoutOverwrite(candidate.path, final);
      const recoveredTimeline = await this.timelineForRecoveredMerge(
        prepared,
        outputFolder,
        safeName,
        exportTimelineTxt
      );
      const warnings = [...validation.warnings, ...recoveredTimeline.warnings];
      warnings.push(
        recoveryMode === 'verified-final'
          ? 'Tubmedia đã kiểm tra đầy đủ thành phẩm hiện có và xác nhận đúng thời lượng, luồng hình/âm thanh, giải mã và tính toàn vẹn hình ảnh; đã bỏ qua ghép lại.'
          : 'Tubmedia đã xác minh checkpoint hoàn chỉnh và tiếp tục thẳng từ bước xuất cuối; không ghép lại từ đầu.'
      );
      try {
        await this.writeMergeCheckpointReceipt(
          receiptPath,
          checkpointSignature,
          recoveredOutput,
          expectedDuration
        );
      } catch (error) {
        warnings.push('Không thể lưu biên nhận checkpoint cho lần chạy sau: ' + String(error));
      }
      emit(
        100,
        recoveryMode === 'verified-final'
          ? 'Thành phẩm cũ hợp lệ · đã bỏ qua ghép lại'
          : 'Đã tiếp tục từ checkpoint và xuất thành phẩm',
        { etaSeconds: 0, processedSeconds: expectedDuration, totalSeconds: expectedDuration }
      );
      return {
        video: recoveredOutput,
        timeline: recoveredTimeline.timeline,
        warnings: [...new Set(warnings)],
        recoveryMode,
        reusedExisting: true,
        visualBoundaryTransitions: validation.boundaryTransitions.map((entry) => ({
          classification: entry.classification,
          type: entry.issue.type,
          outputTimeSeconds: entry.issue.startSeconds,
          outputTime: mergeClock(entry.issue.startSeconds),
          boundarySeconds: entry.boundarySeconds,
          boundaryTime: mergeClock(entry.boundarySeconds),
          boundaryAfterSourceIndex: entry.boundaryIndex + 1,
          durationSeconds: entry.durationSeconds,
          distanceSeconds: entry.distanceSeconds
        }))
      };
    }
    if (normalizationRequired) {
      const target: NormalizeTarget = mergeTarget;
      const progressByItem = new Array<number>(prepared.length).fill(0);
      let finishedItems = 0;
      const normalizeConcurrency = Math.max(1, Math.min(resource.normalizeWorkers, prepared.length));

      emit(15, `Chuẩn hóa thông minh · tối đa ${normalizeConcurrency} video đồng thời`, {
        totalSeconds: knownTotalDuration
      });

      prepared = await mapLimit(
        prepared,
        normalizeConcurrency,
        async (current, index): Promise<PreparedInput> => {
          const match = matchNormalizationTarget(current.info, target);
          if (match.videoMatches && match.audioMatches && !forceUniformVideo && !forceUniformAudio) {
            if (canonicalizeTimeBase) {
              const remuxedPath = await this.normalizer.remuxForConcat(
                job,
                current.path,
                remuxCacheFolder,
                resource,
                signal,
                (percent) => {
                  progressByItem[index] = sanitizeProgress(percent);
                  const aggregate = progressByItem.reduce((sum, value) => sum + value, 0) / prepared.length;
                  emit(15 + aggregate * 0.5, `Chuẩn hóa timestamp video ${index + 1}/${prepared.length}`, {
                    currentItem: Math.max(1, finishedItems + 1),
                    totalSeconds: knownTotalDuration
                  });
                }
              );
              progressByItem[index] = 100;
              finishedItems += 1;
              return {
                ...current,
                path: remuxedPath,
                info: await this.analyzer.analyze(remuxedPath, job.id)
              };
            }
            progressByItem[index] = 100;
            finishedItems += 1;
            const aggregate = progressByItem.reduce((sum, value) => sum + value, 0) / prepared.length;
            emit(15 + aggregate * 0.5, `Video ${index + 1}/${prepared.length} không cần chuẩn hóa`, {
              currentItem: finishedItems,
              totalSeconds: knownTotalDuration
            });
            return current;
          }

          const path = await this.normalizer.normalizeToTarget(
            job,
            current.path,
            current.info,
            normalizeCacheFolder,
            target,
            resource,
            signal,
            (percent) => {
              progressByItem[index] = sanitizeProgress(percent);
              const aggregate = progressByItem.reduce((sum, value) => sum + value, 0) / prepared.length;
              emit(
                15 + aggregate * 0.5,
                match.videoMatches && !forceUniformVideo
                  ? `Chuẩn hóa âm thanh video ${index + 1}/${prepared.length}`
                  : `Chuẩn hóa video ${index + 1}/${prepared.length}`,
                {
                  currentItem: Math.max(1, finishedItems + 1),
                  totalSeconds: knownTotalDuration
                }
              );
            },
            profile,
            undefined,
            forceUniformVideo,
            forceUniformAudio
          );

          progressByItem[index] = 100;
          finishedItems += 1;
          const info = path === current.path ? current.info : await this.analyzer.analyze(path, job.id);
          const aggregate = progressByItem.reduce((sum, value) => sum + value, 0) / prepared.length;
          emit(15 + aggregate * 0.5, `Đã chuẩn bị video ${finishedItems}/${prepared.length}`, {
            currentItem: finishedItems,
            totalSeconds: knownTotalDuration
          });
          return { ...current, path, info };
        }
      );
    } else {
      emit(20, 'Tất cả nguồn tương thích · bỏ qua mã hóa lại', {
        totalSeconds: knownTotalDuration
      });
    }

    // TUBMEDIA CORE RESILIENCE R35: any source that bypassed transcoding must
    // prove it can be decoded end-to-end before concat. Transcoded inputs are
    // already protected by FFmpeg -xerror/-err_detect explode in NormalizeEngine.
    const passthroughIndexes = prepared
      .map((item, index) => (item.path === inputs[index]?.path ? index : -1))
      .filter((index) => index >= 0);
    if (passthroughIndexes.length) {
      let verifiedSources = 0;
      const verifyConcurrency = Math.max(1, Math.min(resource.analyzeWorkers, passthroughIndexes.length));
      emit(
        normalizationRequired ? 66 : 16,
        `Kiểm tra toàn bộ ${passthroughIndexes.length} nguồn stream-copy`,
        {
          totalSeconds: knownTotalDuration
        }
      );
      await mapLimit(passthroughIndexes, verifyConcurrency, async (sourceIndex) => {
        const item = prepared[sourceIndex]!;
        const sourceCheck = await this.verifier.verify(item.path, 'deep', item.info.duration, {
          jobId: job.id + '-source-' + (sourceIndex + 1),
          projectId: job.projectId,
          signal,
          expectedStreams: { video: true, audio: item.info.audioCodec !== null }
        });
        if (!sourceCheck.ok) {
          throw new MergeFailedError(
            'Video nguồn #' +
              (sourceIndex + 1) +
              ' không vượt qua kiểm tra giải mã toàn bộ: ' +
              sourceCheck.reasons.join('; '),
            { phase: 'source-deep-verification', sourceIndex: sourceIndex + 1, sourcePath: item.path }
          );
        }
        verifiedSources += 1;
        emit(
          normalizationRequired
            ? 66 + verifiedSources / passthroughIndexes.length
            : 16 + (verifiedSources / passthroughIndexes.length) * 4,
          `Đã kiểm tra nguồn ${verifiedSources}/${passthroughIndexes.length}`,
          { currentItem: verifiedSources, totalSeconds: knownTotalDuration }
        );
        return true;
      });
    }
    this.assertConcatCompatible(prepared);

    // Paths, duration and stable checkpoint identity were prepared before normalization.
    knownTotalDuration = expectedDuration;

    let mergeStartPercent = normalizationRequired ? 68 : 22;
    emit(mergeStartPercent, 'Ghép nhanh bằng stream copy', {
      totalSeconds: knownTotalDuration
    });

    let result = await this.concatCopy(
      job,
      prepared,
      workFolder,
      pending,
      resource,
      signal,
      mergeStartPercent,
      emit
    );

    // Một số file có codec giống nhau nhưng timestamp/container không sạch.
    // Thay vì mã hóa lại, remux các nguồn sang MP4 rồi concat-copy lần nữa.
    if (result.code !== 0 && !normalizationRequired) {
      await rm(pending, { force: true });
      const remuxProgress = new Array<number>(prepared.length).fill(0);
      let remuxed = 0;
      const remuxConcurrency = Math.max(1, Math.min(resource.remuxWorkers, prepared.length));
      emit(24, `Concat trực tiếp chưa phù hợp · remux nhanh ${remuxConcurrency} luồng`, {
        totalSeconds: knownTotalDuration
      });

      prepared = await mapLimit(prepared, remuxConcurrency, async (current, index) => {
        const path = await this.normalizer.remuxForConcat(
          job,
          current.path,
          remuxCacheFolder,
          resource,
          signal,
          (percent) => {
            remuxProgress[index] = sanitizeProgress(percent);
            const aggregate = remuxProgress.reduce((sum, value) => sum + value, 0) / prepared.length;
            emit(24 + aggregate * 0.3, `Remux video ${index + 1}/${prepared.length}`, {
              currentItem: Math.max(1, remuxed + 1),
              totalSeconds: knownTotalDuration
            });
          }
        );
        remuxProgress[index] = 100;
        remuxed += 1;
        return {
          ...current,
          path,
          info: await this.analyzer.analyze(path, job.id)
        };
      });

      this.assertConcatCompatible(prepared);
      mergeStartPercent = 58;
      result = await this.concatCopy(
        job,
        prepared,
        workFolder,
        pending,
        resource,
        signal,
        mergeStartPercent,
        emit
      );
    }

    if (result.code !== 0) {
      try {
        await access(pending, constants.F_OK);
        await this.quarantine.move(
          pending,
          quarantineFolder,
          result.stderrTail || 'Concat copy thất bại.',
          job.id
        );
      } catch {
        // chưa tạo được pending
      }
      throw new MergeFailedError(result.stderrTail || 'Concat copy thất bại.');
    }

    emit(94, 'Kiểm tra thành phẩm đầu, giữa và cuối', {
      processedSeconds: expectedDuration,
      totalSeconds: expectedDuration
    });
    const verifyOptions: VerificationOptions = {
      jobId: job.id,
      projectId: job.projectId,
      signal,
      expectedStreams: { video: true, audio: expectedAudio }
    };
    let timestampRepairAttempted = false;
    let check = await this.verifyPendingTwice(pending, expectedDuration, verifyOptions);

    // Một số nguồn có timestamp bắt đầu rất lớn hoặc edit-list không sạch.
    // FFmpeg vẫn concat-copy thành công nhưng duration của container có thể bị
    // phóng đại thành nhiều ngày. Không quarantine ngay: remux từng nguồn để
    // đưa timeline về 0, concat lại đúng một lần rồi mới quyết định.
    if (!check.ok && this.shouldRepairTimestamps(check, expectedDuration)) {
      timestampRepairAttempted = true;
      emit(94.4, 'Phát hiện timestamp bất thường · đang tự sửa và ghép lại', {
        processedSeconds: Math.min(check.duration || 0, expectedDuration),
        totalSeconds: expectedDuration
      });
      await rm(pending, { force: true });

      const repairProgress = new Array<number>(prepared.length).fill(0);
      let repaired = 0;
      const repairConcurrency = Math.max(1, Math.min(resource.remuxWorkers, prepared.length));
      prepared = await mapLimit(prepared, repairConcurrency, async (current, index) => {
        const path = await this.normalizer.remuxForConcat(
          job,
          current.path,
          remuxCacheFolder,
          resource,
          signal,
          (percent) => {
            repairProgress[index] = sanitizeProgress(percent);
            const aggregate = repairProgress.reduce((sum, value) => sum + value, 0) / prepared.length;
            emit(94.4 + aggregate * 0.025, `Sửa timestamp video ${index + 1}/${prepared.length}`, {
              currentItem: Math.max(1, repaired + 1),
              totalSeconds: expectedDuration
            });
          }
        );
        repairProgress[index] = 100;
        repaired += 1;
        return {
          ...current,
          path,
          info: await this.analyzer.analyze(path, job.id)
        };
      });

      this.assertConcatCompatible(prepared);
      const repairedConcat = await this.concatCopy(
        job,
        prepared,
        workFolder,
        pending,
        resource,
        signal,
        97,
        emit,
        98
      );
      if (repairedConcat.code !== 0) {
        throw new MergeFailedError(repairedConcat.stderrTail || 'Ghép lại sau khi sửa timestamp thất bại.', {
          phase: 'timestamp-repair-concat',
          expectedDuration,
          originalVerification: check
        });
      }
      check = await this.verifyPendingTwice(pending, expectedDuration, verifyOptions);
    }
    if (!check.ok) {
      const exactReason = check.reasons.join('; ') || 'Không xác định được nguyên nhân xác minh.';
      const quarantined = await this.quarantine.move(pending, quarantineFolder, exactReason, job.id);
      throw new MergeFailedError(
        `Thành phẩm pending không hợp lệ: ${exactReason} Đã chuyển vào quarantine: ${quarantined}`,
        {
          phase: 'verify-merged-output',
          expectedDuration,
          actualDuration: check.duration,
          allowedDifferenceSeconds: Math.max(3, expectedDuration * 0.02),
          reasons: check.reasons,
          pendingPath: pending,
          quarantinePath: quarantined,
          timestampRepairAttempted,
          inputCount: prepared.length,
          inputs: prepared.map((item, index) => ({
            position: index + 1,
            path: item.path,
            duration: item.info.duration,
            codec: item.info.videoCodec,
            width: item.info.width,
            height: item.info.height,
            fps: item.info.fps
          }))
        }
      );
    }

    /* TUBMEDIA FINAL VISUAL GATE R33 */
    const visualWarnings: string[] = [];
    let sourceOriginVisualEvidence: Array<{
      issue: VisualIntegrityIssue;
      sourceIndex: number;
      sourcePath: string;
      sourceLocalTimeSeconds: number;
    }> = [];
    let blockingVisualEvidence: typeof sourceOriginVisualEvidence = [];
    let boundaries = mergeBoundaries(prepared);
    let integrity = await this.verifier.verifyVisualIntegrity(pending, expectedDuration, boundaries, {
      ...verifyOptions,
      onProgress: (percent) => {
        emit(95 + percent * 0.025, 'Đang hậu kiểm toàn bộ hình ảnh 0–100%', {
          processedSeconds: (percent / 100) * expectedDuration,
          totalSeconds: expectedDuration
        });
      }
    });

    ({
      integrity,
      sourceOriginEvidence: sourceOriginVisualEvidence,
      blockingEvidence: blockingVisualEvidence
    } = await this.reconcileVisualIssuesWithOriginalSources(integrity, visualReferenceInputs, job, signal));
    for (const evidence of sourceOriginVisualEvidence) {
      const reference = visualReferenceInputs[evidence.sourceIndex]!;
      const kind = evidence.issue.type === 'black' ? 'đoạn hình đen/chuyển cảnh' : 'đoạn hình đứng';
      visualWarnings.push(
        'Nguồn #' +
          (evidence.sourceIndex + 1) +
          ' – ' +
          (reference.label || reference.path) +
          ' có sẵn ' +
          kind +
          ' quanh ' +
          mergeClock(evidence.issue.startSeconds) +
          ' (trong nguồn khoảng ' +
          mergeClock(evidence.sourceLocalTimeSeconds) +
          '). Tubmedia đã xác nhận đây là nội dung có sẵn trong nguồn, không phải lỗi do ghép tạo ra.'
      );
    }

    /* TUBMEDIA VISUAL BOUNDARY UX HOTFIX11 */
    const acceptedBoundaryTransitionKeys = new Set<string>();
    const boundaryTransitionVisualEvidence: VisualBoundaryTransitionEvidence[] = [];
    const acceptShortBoundaryTransitions = (): void => {
      const policy = applyShortVisualBoundaryPolicy(integrity, boundaries);
      integrity = policy.integrity;
      const acceptedIssues = new Set<VisualIntegrityIssue>(policy.accepted.map((entry) => entry.issue));
      if (acceptedIssues.size > 0) {
        blockingVisualEvidence = blockingVisualEvidence.filter((entry) => !acceptedIssues.has(entry.issue));
      }
      for (const evidence of policy.accepted) {
        const key =
          evidence.issue.type + ':' + evidence.issue.startSeconds.toFixed(3) + ':' + evidence.boundaryIndex;
        if (acceptedBoundaryTransitionKeys.has(key)) continue;
        acceptedBoundaryTransitionKeys.add(key);
        boundaryTransitionVisualEvidence.push(evidence);
        visualWarnings.push(visualBoundaryTransitionWarning(evidence));
      }
    };
    acceptShortBoundaryTransitions();

    const boundaryCorruption = integrity.issues.some((issue) =>
      isVisualIssueNearBoundary(issue, boundaries, 2.5)
    );
    let visualRepairAttempted = false;
    if (!integrity.ok && boundaryCorruption) {
      visualRepairAttempted = true;
      emit(97.6, 'Phát hiện lỗi gần điểm nối · đang mã hóa lại để tự sửa', {
        totalSeconds: expectedDuration
      });
      await rm(pending, { force: true });
      const repairTarget: NormalizeTarget = mergeTarget;
      const repairSource = prepared;
      const repairProgress = new Array<number>(repairSource.length).fill(0);
      prepared = await mapLimit(
        repairSource,
        Math.max(1, Math.min(resource.normalizeWorkers, repairSource.length)),
        async (current, index) => {
          const repairedPath = await this.normalizer.normalizeToTarget(
            job,
            current.path,
            current.info,
            normalizeCacheFolder,
            repairTarget,
            resource,
            signal,
            (percent) => {
              repairProgress[index] = sanitizeProgress(percent);
              const aggregate = repairProgress.reduce((sum, value) => sum + value, 0) / repairSource.length;
              emit(
                97.6 + aggregate * 0.008,
                'Tự sửa hình ảnh video ' + (index + 1) + '/' + repairSource.length,
                {
                  currentItem: index + 1,
                  totalSeconds: expectedDuration
                }
              );
            },
            profile,
            undefined,
            true
          );
          return {
            ...current,
            path: repairedPath,
            info: await this.analyzer.analyze(repairedPath, job.id)
          };
        }
      );
      this.assertConcatCompatible(prepared);
      const visualRepairConcat = await this.concatCopy(
        job,
        prepared,
        workFolder,
        pending,
        resource,
        signal,
        98.4,
        emit,
        98.8
      );
      if (visualRepairConcat.code !== 0) {
        throw new MergeFailedError(
          visualRepairConcat.stderrTail || 'Tự sửa thành phẩm sau lỗi hình ảnh thất bại.',
          { phase: 'visual-repair-concat' }
        );
      }
      check = await this.verifyPendingTwice(pending, expectedDuration, verifyOptions);
      if (check.ok) {
        boundaries = mergeBoundaries(prepared);
        integrity = await this.verifier.verifyVisualIntegrity(
          pending,
          expectedDuration,
          boundaries,
          verifyOptions
        );
        ({
          integrity,
          sourceOriginEvidence: sourceOriginVisualEvidence,
          blockingEvidence: blockingVisualEvidence
        } = await this.reconcileVisualIssuesWithOriginalSources(
          integrity,
          visualReferenceInputs,
          job,
          signal
        ));
        for (const evidence of sourceOriginVisualEvidence) {
          const reference = visualReferenceInputs[evidence.sourceIndex]!;
          const kind = evidence.issue.type === 'black' ? 'đoạn hình đen/chuyển cảnh' : 'đoạn hình đứng';
          visualWarnings.push(
            'Nguồn #' +
              (evidence.sourceIndex + 1) +
              ' – ' +
              (reference.label || reference.path) +
              ' có sẵn ' +
              kind +
              ' quanh ' +
              mergeClock(evidence.issue.startSeconds) +
              ' (trong nguồn khoảng ' +
              mergeClock(evidence.sourceLocalTimeSeconds) +
              '). Tubmedia đã xác nhận đây là nội dung có sẵn trong nguồn, không phải lỗi do ghép tạo ra.'
          );
        }
        acceptShortBoundaryTransitions();
      } else {
        integrity = {
          ok: false,
          reasons: check.reasons,
          issues: integrity.issues
        };
      }
    }

    if (!integrity.ok) {
      const firstIssue = integrity.issues[0];
      const issueTime = firstIssue?.startSeconds ?? 0;
      const firstEvidence =
        blockingVisualEvidence.find((entry) => entry.issue === firstIssue) ?? blockingVisualEvidence[0];
      const source = firstEvidence
        ? { index: firstEvidence.sourceIndex, item: visualReferenceInputs[firstEvidence.sourceIndex]! }
        : locateVisualIssue(visualReferenceInputs, issueTime);
      const userReason =
        firstIssue?.message ?? integrity.reasons[0] ?? 'Phát hiện lỗi hình ảnh trong thành phẩm.';
      const sourceLabel = source
        ? ' Video nguồn liên quan: #' +
          (source.index + 1) +
          ' – ' +
          (source.item.label || source.item.path) +
          '.'
        : '';
      const quarantineReason = integrity.reasons.join('; ') || userReason;
      const quarantined = await this.quarantine.move(pending, quarantineFolder, quarantineReason, job.id);
      throw new MergeFailedError(
        'Tubmedia đã CHẶN thành phẩm vì phát hiện lỗi hình ảnh tại khoảng ' +
          mergeClock(issueTime) +
          '. ' +
          userReason +
          sourceLabel +
          ' File lỗi đã được chuyển vào khu cách ly và KHÔNG được xuất làm thành phẩm.',
        {
          phase: 'visual-integrity-verification',
          expectedDuration,
          problemTimeSeconds: issueTime,
          problemTime: mergeClock(issueTime),
          sourceIndex: source ? source.index + 1 : null,
          sourcePath: source?.item.path ?? null,
          visualRepairAttempted,
          boundaryTransitionVisualIssues: boundaryTransitionVisualEvidence.map((entry) => ({
            classification: entry.classification,
            type: entry.issue.type,
            outputTimeSeconds: entry.issue.startSeconds,
            outputTime: mergeClock(entry.issue.startSeconds),
            boundarySeconds: entry.boundarySeconds,
            boundaryTime: mergeClock(entry.boundarySeconds),
            boundaryAfterSourceIndex: entry.boundaryIndex + 1,
            durationSeconds: entry.durationSeconds,
            distanceSeconds: entry.distanceSeconds
          })),
          visualIssues: integrity.issues,
          visualIssueSources: blockingVisualEvidence.map((entry) => ({
            type: entry.issue.type,
            outputTimeSeconds: entry.issue.startSeconds,
            outputTime: mergeClock(entry.issue.startSeconds),
            sourceIndex: entry.sourceIndex + 1,
            sourcePath: entry.sourcePath,
            sourceLocalTimeSeconds: entry.sourceLocalTimeSeconds,
            sourceLocalTime: mergeClock(entry.sourceLocalTimeSeconds)
          })),
          sourceOriginVisualIssues: sourceOriginVisualEvidence.map((entry) => ({
            type: entry.issue.type,
            outputTimeSeconds: entry.issue.startSeconds,
            sourceIndex: entry.sourceIndex + 1,
            sourcePath: entry.sourcePath,
            sourceLocalTimeSeconds: entry.sourceLocalTimeSeconds
          })),
          quarantinePath: quarantined
        }
      );
    }

    const pendingInfo = await this.analyzer.analyze(pending, job.id);
    if (expectedAudio) {
      const videoDuration = pendingInfo.videoStreamDuration ?? pendingInfo.duration;
      const audioDuration = pendingInfo.audioStreamDuration;
      if (audioDuration === null || audioDuration === undefined) {
        const quarantined = await this.quarantine.move(
          pending,
          quarantineFolder,
          'Thành phẩm được yêu cầu có âm thanh nhưng không tìm thấy thời lượng audio stream.',
          job.id
        );
        throw new MergeFailedError(
          'Tubmedia đã chặn thành phẩm vì luồng âm thanh bị thiếu. File lỗi đã chuyển vào khu cách ly: ' +
            quarantined
        );
      }
      const avDrift = Math.abs(videoDuration - audioDuration);
      const avTolerance = Math.max(1.25, Math.min(4, expectedDuration * 0.0015));
      if (avDrift > avTolerance) {
        const quarantined = await this.quarantine.move(
          pending,
          quarantineFolder,
          'Lệch thời lượng audio/video ' + avDrift.toFixed(2) + 's.',
          job.id
        );
        throw new MergeFailedError(
          'Tubmedia đã chặn thành phẩm vì âm thanh và hình ảnh lệch ' +
            avDrift.toFixed(2) +
            ' giây (giới hạn ' +
            avTolerance.toFixed(2) +
            ' giây). File lỗi đã chuyển vào khu cách ly: ' +
            quarantined,
          { phase: 'av-sync-verification', avDriftSeconds: avDrift, toleranceSeconds: avTolerance }
        );
      }
    }
    const sizeValidation = validateMergeOutputSize(infos, pendingInfo.fileSize, profile);
    if (!sizeValidation.ok) {
      const quarantined = await this.quarantine.move(
        pending,
        quarantineFolder,
        sizeValidation.message ?? 'Dung lượng thành phẩm thấp bất thường.',
        job.id
      );
      throw new MergeFailedError(
        `Tubmedia đã chặn thành phẩm bị nén nhỏ bất thường và chuyển vào khu cách ly: ${quarantined}. ${sizeValidation.message ?? ''}`
      );
    }

    const finalizePercent = 99;
    emit(finalizePercent, 'Thành phẩm hợp lệ, đang ghi tệp cuối', {
      processedSeconds: expectedDuration,
      totalSeconds: expectedDuration
    });
    let committedFinal: string;
    try {
      committedFinal = await commitFileWithoutOverwrite(pending, final);
    } catch (error) {
      throw new MergeFailedError(`Không thể commit thành phẩm an toàn: ${String(error)}`);
    }
    try {
      await this.writeMergeCheckpointReceipt(
        receiptPath,
        checkpointSignature,
        committedFinal,
        expectedDuration
      );
    } catch (error) {
      visualWarnings.push('Video đã hoàn tất nhưng không thể lưu biên nhận checkpoint: ' + String(error));
    }

    emit(timestampRepairAttempted ? 99.5 : 99, 'Đang tạo timeline thành phẩm', {
      processedSeconds: expectedDuration,
      totalSeconds: expectedDuration
    });
    const timelineInputs = prepared.map((item) => ({
      path: item.path,
      label: item.label,
      note: item.note
    }));
    const warnings: string[] = [...new Set(visualWarnings)];
    let timeline: TimelineArtifact;
    try {
      timeline = await this.timeline.write(timelineInputs, outputFolder, safeName, exportTimelineTxt);
    } catch (error) {
      warnings.push(`Video đã hoàn tất nhưng không thể tạo hoặc ghi timeline TXT: ${String(error)}`);
      let cursor = 0;
      const rows: TimelineRow[] = prepared.map((item, index) => {
        const start = cursor;
        cursor += item.info.duration;
        return {
          index: index + 1,
          start,
          end: cursor,
          duration: item.info.duration,
          code: formatTimelineLine(start, index + 1),
          label: item.label,
          note: item.note,
          file: item.path
        };
      });
      timeline = { txt: null, totalDuration: cursor, itemCount: rows.length, rows };
    }

    emit(100, 'Ghép và kiểm tra thành phẩm hoàn tất', {
      etaSeconds: 0,
      processedSeconds: expectedDuration,
      totalSeconds: expectedDuration
    });
    return {
      video: committedFinal,
      timeline,
      warnings,
      recoveryMode: 'new-merge',
      reusedExisting: false,
      visualBoundaryTransitions: boundaryTransitionVisualEvidence.map((entry) => ({
        classification: entry.classification,
        type: entry.issue.type,
        outputTimeSeconds: entry.issue.startSeconds,
        outputTime: mergeClock(entry.issue.startSeconds),
        boundarySeconds: entry.boundarySeconds,
        boundaryTime: mergeClock(entry.boundarySeconds),
        boundaryAfterSourceIndex: entry.boundaryIndex + 1,
        durationSeconds: entry.durationSeconds,
        distanceSeconds: entry.distanceSeconds
      }))
    };
  }

  private async reconcileVisualIssuesWithOriginalSources(
    integrity: VisualIntegrityResult,
    visualReferences: readonly PreparedInput[],
    job: QueueJob,
    signal: AbortSignal
  ): Promise<{
    integrity: VisualIntegrityResult;
    sourceOriginEvidence: Array<{
      issue: VisualIntegrityIssue;
      sourceIndex: number;
      sourcePath: string;
      sourceLocalTimeSeconds: number;
    }>;
    blockingEvidence: Array<{
      issue: VisualIntegrityIssue;
      sourceIndex: number;
      sourcePath: string;
      sourceLocalTimeSeconds: number;
    }>;
  }> {
    const sourceOriginEvidence: Array<{
      issue: VisualIntegrityIssue;
      sourceIndex: number;
      sourcePath: string;
      sourceLocalTimeSeconds: number;
    }> = [];
    const blockingEvidence: typeof sourceOriginEvidence = [];
    const blockingIssues: VisualIntegrityIssue[] = [];
    const durations = visualReferences.map((item) => item.info.duration);

    for (const issue of integrity.issues) {
      if (issue.type === 'decode') {
        blockingIssues.push(issue);
        const source = locateVisualIssue(visualReferences, issue.startSeconds);
        if (source) {
          blockingEvidence.push({
            issue,
            sourceIndex: source.index,
            sourcePath: source.item.path,
            sourceLocalTimeSeconds: Math.max(
              0,
              issue.startSeconds -
                visualReferences.slice(0, source.index).reduce((sum, item) => sum + item.info.duration, 0)
            )
          });
        }
        continue;
      }

      const segments = mapVisualIssueToSourceSegments(issue, durations, 3);
      let matched: { index: number; localStartSeconds: number } | null = null;
      for (const segment of segments) {
        const reference = visualReferences[segment.index];
        if (!reference) continue;
        const sourceHasIssue = await this.verifier.sourceContainsVisualIssue(
          reference.path,
          issue,
          segment.localStartSeconds,
          segment.localEndSeconds,
          {
            jobId: job.id + '-visual-reference-' + (segment.index + 1),
            projectId: job.projectId,
            signal
          }
        );
        if (sourceHasIssue) {
          matched = { index: segment.index, localStartSeconds: segment.localStartSeconds };
          break;
        }
      }

      if (matched) {
        const reference = visualReferences[matched.index]!;
        sourceOriginEvidence.push({
          issue,
          sourceIndex: matched.index,
          sourcePath: reference.path,
          sourceLocalTimeSeconds: matched.localStartSeconds
        });
        continue;
      }

      blockingIssues.push(issue);
      const source = locateVisualIssue(visualReferences, issue.startSeconds);
      if (source) {
        const sourceStart = visualReferences
          .slice(0, source.index)
          .reduce((sum, item) => sum + item.info.duration, 0);
        blockingEvidence.push({
          issue,
          sourceIndex: source.index,
          sourcePath: source.item.path,
          sourceLocalTimeSeconds: Math.max(0, issue.startSeconds - sourceStart)
        });
      }
    }

    const blockingReasons = blockingIssues.map((issue) => issue.message);
    return {
      integrity: {
        ok: blockingIssues.length === 0,
        reasons: blockingReasons,
        issues: blockingIssues
      },
      sourceOriginEvidence,
      blockingEvidence
    };
  }

  private assertConcatCompatible(prepared: PreparedInput[]): void {
    const reference = prepared[0]!.info;
    const incompatible = prepared.flatMap((item, index) =>
      index === 0
        ? []
        : compareForConcat(reference, item.info).reasons.map((reason) => `Video ${index + 1}: ${reason}`)
    );
    if (incompatible.length) {
      throw new MergeFailedError(
        `Các file vẫn chưa tương thích concat: ${incompatible.slice(0, 10).join('; ')}`
      );
    }
  }

  private async verifyPendingTwice(
    pending: string,
    expectedDuration: number,
    options: VerificationOptions
  ): Promise<VerificationResult> {
    let check = await this.verifier.verify(pending, 'standard', expectedDuration, options);
    if (check.ok) return check;

    // Đợi hệ thống tệp hoàn tất flush metadata rồi phân tích lại một lần.
    // Cách này tránh quarantine nhầm MP4 stream-copy vừa đóng file xong.
    if (options.signal) {
      await delay(650, undefined, { signal: options.signal });
    } else {
      await delay(650);
    }
    this.analyzer.forget(pending);
    check = await this.verifier.verify(pending, 'standard', expectedDuration, options);
    return check;
  }

  private shouldRepairTimestamps(check: VerificationResult, expectedDuration: number): boolean {
    if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) return false;
    const tolerance = Math.max(3, expectedDuration * 0.02);
    const durationMismatch =
      !Number.isFinite(check.duration) ||
      check.duration <= 0 ||
      Math.abs(check.duration - expectedDuration) > tolerance;
    const timestampReason = check.reasons.some((reason) => {
      const lower = reason.toLowerCase();
      return (
        lower.includes('thời lượng lệch') ||
        lower.includes('timestamp') ||
        lower.includes('không đọc được mẫu') ||
        lower.includes('không giải mã được mẫu')
      );
    });
    return durationMismatch || timestampReason;
  }

  private async concatCopy(
    job: QueueJob,
    prepared: PreparedInput[],
    workFolder: string,
    pending: string,
    resource: ResourceProfile,
    signal: AbortSignal,
    mergeStartPercent: number,
    emit: (
      percent: number,
      stage: string,
      detail?: Partial<Omit<MergeProgress, 'percent' | 'stage' | 'elapsedSeconds' | 'itemCount'>>
    ) => void,
    mergeEndPercent = 92
  ): Promise<ProcessResult> {
    const ffmpeg = this.tools.get('ffmpeg');
    if (!ffmpeg.available || !ffmpeg.executablePath) throw new ToolNotFoundError('ffmpeg');

    const concatPath = join(workFolder, `concat-${job.id}.txt`);
    await writeFile(
      concatPath,
      prepared
        .map((item) =>
          [
            `file '${escapeConcatPath(item.path)}'`,
            `duration ${Math.max(0.001, item.info.duration).toFixed(6)}`
          ].join('\r\n')
        )
        .join('\r\n'),
      'utf8'
    );
    await rm(pending, { force: true });

    const expectedDuration = prepared.reduce((sum, item) => sum + item.info.duration, 0);
    const tracker = new FfmpegProgressTracker(expectedDuration);
    try {
      return await this.processes.run({
        jobId: job.id,
        projectId: job.projectId,
        tool: 'ffmpeg',
        executablePath: ffmpeg.executablePath,
        args: [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatPath,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c',
          'copy',
          '-avoid_negative_ts',
          'make_zero',
          '-movflags',
          '+faststart',
          '-progress',
          'pipe:1',
          '-nostats',
          pending
        ],
        priority: resource.processPriority,
        signal,
        timeoutMs: 24 * 60 * 60 * 1000,
        onStdoutLine: (line) => {
          const snapshot = tracker.update(line);
          if (!snapshot) return;
          emit(
            mergeStartPercent + (snapshot.percent / 100) * (mergeEndPercent - mergeStartPercent),
            `Đang ghép ${prepared.length} video bằng stream copy`,
            {
              speed: snapshot.speed,
              etaSeconds: snapshot.etaSeconds,
              processedSeconds: snapshot.processedSeconds,
              totalSeconds: snapshot.totalSeconds
            }
          );
        }
      });
    } finally {
      await rm(concatPath, { force: true });
    }
  }
}
