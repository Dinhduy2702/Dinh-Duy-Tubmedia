import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import safeExtractZip from '@tubmedia/safe-extract-zip';
import { collectErrorReport, ErrorReportService, type ErrorReportDeps, type ReportedFile } from '../../src/main/diagnostics/error-report.js';
import type { LogEntry, MediaSource, Project, ProjectItem, QueueJob } from '../../src/shared/types/domain.js';
import type { ErrorReportStatus } from '../../src/shared/types/error-report.js';
import { corruptMiddleAudioPackets, makeClip, realMediaStack, resolveRealFfmpegDirectory } from './helpers/real-ffmpeg.js';

/**
 * Vụ MERGE_FAILED 2026-10-15: hậu kiểm chỉ nêu "lỗi giải mã gần 11:05" của thành phẩm; phải nhờ khách chạy hai khối lệnh
 * PowerShell mới tìm ra bản đệm chuẩn hóa của NA361 hỏng tiếng. Báo cáo lỗi phải tự giải mã lại MỌI nguồn + bản đệm và chỉ
 * ra đúng tệp hỏng.
 */
const toolsDirectory = resolveRealFfmpegDirectory();
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

function item(position: number, sourceId: string): ProjectItem {
  return {
    id: `item-${position}`,
    projectId: PROJECT_ID,
    position,
    sourceId,
    clipFile: null,
    enabled: true,
    createdAt: '',
    updatedAt: '',
    originalText: '',
    url: `https://youtu.be/v${position}`,
    normalizedUrl: `https://youtu.be/v${position}`,
    platform: 'youtube',
    extractorKey: 'Youtube',
    mediaId: `v${position}`,
    timestampStartSeconds: null,
    timestampEndSeconds: null,
    note: '',
    audioMode: 'keep',
    validity: 'valid',
    warnings: [],
    errors: []
  } as unknown as ProjectItem;
}

async function setup(): Promise<{
  deps: ErrorReportDeps;
  folder: string;
  clean: string;
  broken: string;
  brokenCache: string;
  stack: ReturnType<typeof realMediaStack>;
}> {
  const folder = await mkdtemp(join(tmpdir(), 'tubmedia-error-report-'));
  folders.push(folder);
  const clean = join(folder, 'nguon', 'NA360_TA.mp4');
  const broken = join(folder, 'nguon', 'NA361_TA.mp4');
  mkdirSync(join(folder, 'nguon'));
  makeClip(toolsDirectory!, clean, { width: 320, height: 180, fps: 15, seconds: 5, sampleRate: 44100 });
  makeClip(toolsDirectory!, broken, { width: 320, height: 180, fps: 15, seconds: 5, sampleRate: 44100 });
  // Đúng kiểu vụ khách: NGUỒN sạch, BẢN ĐỆM chuẩn hóa của nó hỏng tiếng.
  const tempFolder = join(folder, 'tam');
  mkdirSync(join(tempFolder, '_normalized-cache'), { recursive: true });
  mkdirSync(join(tempFolder, '_remux-cache'), { recursive: true });
  const brokenCache = join(tempFolder, '_normalized-cache', 'NA361_TA.0123456789abcdef.normalized-320x180-15fps.mp4');
  copyFileSync(broken, brokenCache);
  corruptMiddleAudioPackets(toolsDirectory!, brokenCache);
  copyFileSync(clean, join(tempFolder, '_remux-cache', 'NA360_TA.fedcba9876543210.remux.mp4'));
  copyFileSync(clean, join(tempFolder, '_remux-cache', 'NA360_TA.fedcba9876543210.remux.mp4.1a2b3c4d.pending.mp4'));

  const project = { id: PROJECT_ID, name: 'Hậu maxhunter 21 10 26', code: 'X', status: 'active', tempFolder, outputFolder: folder } as Project;
  const sources: Record<string, MediaSource> = {
    s1: { id: 's1', sourceFile: clean } as MediaSource,
    s2: { id: 's2', sourceFile: broken } as MediaSource,
    s3: { id: 's3', sourceFile: join(folder, 'nguon', 'DA_XOA.mp4') } as MediaSource
  };
  const job = {
    id: JOB_ID,
    projectId: PROJECT_ID,
    type: 'merge',
    status: 'failed',
    errorCode: 'MERGE_FAILED',
    errorMessage: 'Tubmedia đã CHẶN thành phẩm vì phát hiện lỗi giải mã âm thanh tại khoảng 00:11:05.',
    input: { cookie: 'SID=bimat' }
  } as unknown as QueueJob;
  const logs: LogEntry[] = [
    { id: 'l2', timestamp: '2026-10-15T02:00:02Z', level: 'error', module: 'queue', jobId: JOB_ID, projectId: PROJECT_ID, eventCode: 'JOB_FAILED', message: 'chặn', metadata: { details: { problemTime: '00:11:05' } } },
    { id: 'l1', timestamp: '2026-10-15T02:00:01Z', level: 'info', module: 'normalize', jobId: JOB_ID, projectId: PROJECT_ID, eventCode: 'NORMALIZE_CACHE_HIT', message: 'dùng lại' }
  ];
  const stack = realMediaStack(toolsDirectory!);
  const deps: ErrorReportDeps = {
    getJob: (id) => (id === JOB_ID ? job : null),
    getProject: (id) => (id === PROJECT_ID ? project : null),
    listItems: () => [item(1, 's1'), item(2, 's2'), item(3, 's3')],
    getSource: (id) => sources[id] ?? null,
    listLogs: (query) => logs.filter((entry) => (query.jobId ? entry.jobId === query.jobId : entry.projectId === query.projectId)),
    listTools: () =>
      (['ffmpeg', 'ffprobe'] as const).map((name) => ({
        name,
        available: true,
        executablePath: join(toolsDirectory!, name + '.exe'),
        version: 'test',
        source: 'bundled' as const,
        capabilities: [],
        health: 'healthy' as const,
        error: null,
        lastCheckedAt: null
      })),
    analyzer: stack.analyzer,
    verifier: stack.verifier,
    appInfo: () => ({ appVersion: '1.7.0-test', buildCommit: 'abc1234' }),
    hardware: () => Promise.resolve({ cpu: 'test' })
  };
  return { deps, folder, clean, broken, brokenCache, stack };
}

function sha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function waitDone(service: ErrorReportService, runId: string): Promise<ErrorReportStatus> {
  for (let index = 0; index < 600; index += 1) {
    const status = service.status(runId)!;
    if (status.state !== 'running') return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Báo cáo không xong sau 60 s');
}

describe.skipIf(!toolsDirectory)('Xuất báo cáo lỗi (ffmpeg thật)', () => {
  it('giải mã lại MỌI nguồn + bản đệm, chỉ ra đúng bản đệm hỏng tiếng; SHA256 đúng; che bí mật; bỏ tệp .pending', async () => {
    const { deps, clean, broken, brokenCache } = await setup();
    const steps: string[] = [];
    const entries = await collectErrorReport(deps, JOB_ID, new AbortController().signal, (step) => void steps.push(step));
    const byName = new Map(entries.map((entry) => [entry.name, String(entry.data)]));

    expect([...byName.keys()]).toEqual(['tom-tat.txt', 'bao-cao.json', 'nhat-ky/tac-vu.jsonl', 'nhat-ky/danh-sach.jsonl']);
    const report = JSON.parse(byName.get('bao-cao.json')!) as { files: ReportedFile[]; failure: LogEntry | null; job: QueueJob; appVersion: string };
    const file = (path: string): ReportedFile => report.files.find((entry) => entry.path === path)!;

    expect(report.files.map((entry) => entry.role)).toEqual(['nguồn', 'nguồn', 'nguồn', 'bản đệm remux', 'bản đệm chuẩn hóa']);
    expect(report.files.some((entry) => entry.path.endsWith('.pending.mp4'))).toBe(false);
    expect(file(clean)).toMatchObject({ exists: true, videoDecode: 'ok', audioDecode: 'ok', sha256: sha(clean) });
    expect(file(broken)).toMatchObject({ exists: true, videoDecode: 'ok', audioDecode: 'ok', sha256: sha(broken) });
    expect(file(brokenCache).videoDecode).toBe('ok');
    expect(file(brokenCache).audioDecode, 'bản đệm hỏng tiếng phải có câu lỗi ffmpeg').not.toBe('ok');
    expect(file(brokenCache).position).toBe(2);
    expect(report.files.find((entry) => entry.path.endsWith('DA_XOA.mp4'))).toMatchObject({ exists: false, sha256: null });
    expect(report.failure?.eventCode).toBe('JOB_FAILED');
    expect(JSON.stringify(report)).not.toContain('SID=bimat');

    const summary = byName.get('tom-tat.txt')!;
    expect(summary).toContain('#2 [bản đệm chuẩn hóa] NA361_TA.0123456789abcdef.normalized-320x180-15fps.mp4: HỎNG TIẾNG');
    expect(summary).toContain('#2 [nguồn] NA361_TA.mp4: sạch');
    expect(summary).toContain('#3 [nguồn] DA_XOA.mp4: KHÔNG CÒN TRÊN Ổ');
    expect(byName.get('nhat-ky/tac-vu.jsonl')!.trim().split('\n').map((line) => (JSON.parse(line) as LogEntry).id)).toEqual(['l1', 'l2']);
    expect(steps.some((step) => step.startsWith('Đang kiểm bản đệm chuẩn hóa 5/5'))).toBe(true);
  }, 180_000);

  it('dịch vụ chạy nền ghi ra .zip giải nén được; hủy giữa chừng → không để lại tệp nào', async () => {
    const { deps, folder, stack } = await setup();
    const service = new ErrorReportService(deps);
    const output = join(folder, 'bao-cao-loi.zip');

    const started = service.start(JOB_ID, output);
    expect(() => service.start(JOB_ID, join(folder, 'khac.zip')), 'chỉ một lượt mỗi lúc').toThrow();
    const done = await waitDone(service, started.runId);
    expect(done).toMatchObject({ state: 'completed', error: null, total: 5, current: 5 });
    const out = join(folder, 'giai-nen');
    await safeExtractZip(output, { dir: out });
    expect(await readFile(join(out, 'tom-tat.txt'), 'utf8')).toContain('HỎNG TIẾNG');

    // Hủy đúng lúc đang giải mã tệp đầu tiên.
    const cancelOutput = join(folder, 'huy.zip');
    const cancelService = new ErrorReportService(deps);
    let runId = '';
    const decode = stack.verifier.decodeStreamFailure.bind(stack.verifier);
    deps.verifier = {
      decodeStreamFailure: (path, stream, options) => {
        cancelService.cancel(runId);
        return decode(path, stream, options);
      }
    };
    runId = cancelService.start(JOB_ID, cancelOutput).runId;
    const cancelled = await waitDone(cancelService, runId);
    expect(cancelled.state).toBe('cancelled');
    expect(existsSync(cancelOutput)).toBe(false);
    expect(readdirSync(folder).filter((name) => name.endsWith('.part'))).toEqual([]);
  }, 180_000);
});
