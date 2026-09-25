import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  shell: { showItemInFolder: vi.fn() }
}));

import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';

const roots: string[] = [];

interface RunOptions {
  tool: string;
  args: string[];
  onStdoutLine?: (line: string) => void;
}

type Behaviour = { hasAudio: boolean; ffmpegExitCode?: number };

async function createFixture(behaviour: Behaviour) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-quick-videoonly-'));
  roots.push(root);
  const outputDirectory = join(root, 'thư mục có dấu & khoảng trắng');
  await mkdir(outputDirectory, { recursive: true });
  const file = join(outputDirectory, 'clip [abc] [QD-test].mp4');

  const calls: Array<{ tool: string; args: string[] }> = [];
  const processes = {
    run: vi.fn(async (options: RunOptions) => {
      calls.push({ tool: options.tool, args: options.args });
      if (options.tool === 'yt-dlp') {
        await writeFile(file, 'hinh-va-tieng');
        options.onStdoutLine?.(`TUBMEDIA_FILE|${file}`);
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }
      if (options.tool === 'ffprobe') {
        return { code: 0, stdoutTail: behaviour.hasAudio ? '1\n' : '', stderrTail: '', durationMs: 1 };
      }
      const code = behaviour.ffmpegExitCode ?? 0;
      if (code === 0) await writeFile(options.args.at(-1)!, 'chi-co-hinh');
      return { code, stdoutTail: '', stderrTail: code === 0 ? '' : 'loi ghep kenh', durationMs: 1 };
    }),
    hasJob: vi.fn(() => false),
    pauseByJob: vi.fn(() => Promise.resolve()),
    resumeByJob: vi.fn(() => Promise.resolve()),
    killByJob: vi.fn(() => Promise.resolve())
  };
  const tools = {
    ensureRequiredReady: vi.fn(() => Promise.resolve([])),
    get: vi.fn((name: string) => ({ name, available: true, executablePath: join(root, `${name}.exe`) }))
  };
  const verifier = { verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 3 })) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new QuickDownloadService(
    processes as never,
    tools as never,
    verifier as never,
    logger as never,
    join(root, 'state')
  );
  return { outputDirectory, file, calls, service, verifier };
}

async function run(fixture: Awaited<ReturnType<typeof createFixture>>, mediaMode: 'video-only' | 'video-audio') {
  const started = await fixture.service.start({
    url: 'https://example.com/clip.mp4',
    outputDirectory: fixture.outputDirectory,
    quality: 'best',
    mediaMode,
    mode: 'full',
    accurateCut: false,
    // Bài kiểm này chỉ về việc cắt bỏ âm thanh — tắt credit metadata (Giai đoạn 6 mục 1) để không
    // thêm một lượt gọi ffmpeg không liên quan vào stub processes.run dùng chung ở trên.
    embedCredit: false
  });
  await vi.waitFor(
    () => expect(['completed', 'failed']).toContain(fixture.service.status(started.taskId)?.phase),
    { timeout: 5000 }
  );
  return fixture.service.status(started.taskId)!;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Tải nhanh: chế độ "Chỉ video" phải cho tệp không có âm thanh', () => {
  it('cắt bỏ âm thanh bằng stream copy khi nguồn chỉ có luồng gộp', async () => {
    const fixture = await createFixture({ hasAudio: true });
    const status = await run(fixture, 'video-only');

    const ffmpeg = fixture.calls.find((call) => call.tool === 'ffmpeg');
    expect(ffmpeg?.args).toEqual(expect.arrayContaining(['-map', '0:v', '-c', 'copy', '-an']));
    expect(ffmpeg?.args).toContain(fixture.file);
    expect(status.phase).toBe('completed');
    expect(status.warnings).toEqual([]);
    expect(await readFile(fixture.file, 'utf8')).toBe('chi-co-hinh');
    // tệp tạm .noaudio đã được đổi tên vào chỗ tệp gốc, không còn sót lại
    expect(await readdir(fixture.outputDirectory)).toEqual(['clip [abc] [QD-test].mp4']);
  });

  it('không chạy FFmpeg khi tệp vốn không có âm thanh', async () => {
    const fixture = await createFixture({ hasAudio: false });
    const status = await run(fixture, 'video-only');

    expect(fixture.calls.some((call) => call.tool === 'ffmpeg')).toBe(false);
    expect(status.phase).toBe('completed');
    expect(await readFile(fixture.file, 'utf8')).toBe('hinh-va-tieng');
  });

  it('cắt âm thanh lỗi thì giữ nguyên tệp gốc, báo cảnh báo và không để lại tệp tạm', async () => {
    const fixture = await createFixture({ hasAudio: true, ffmpegExitCode: 1 });
    const status = await run(fixture, 'video-only');

    expect(status.phase).toBe('completed');
    expect(status.warnings.join(' ')).toContain('Không loại được âm thanh');
    expect(await readFile(fixture.file, 'utf8')).toBe('hinh-va-tieng');
    expect(await readdir(fixture.outputDirectory)).toEqual(['clip [abc] [QD-test].mp4']);
  });

  it('không đụng tới âm thanh ở chế độ Video + âm thanh', async () => {
    const fixture = await createFixture({ hasAudio: true });
    await run(fixture, 'video-audio');

    expect(fixture.calls.map((call) => call.tool)).toEqual(['yt-dlp']);
    expect(await readFile(fixture.file, 'utf8')).toBe('hinh-va-tieng');
  });
});
