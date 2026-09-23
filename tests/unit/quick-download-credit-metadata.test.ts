import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

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

interface Behaviour {
  uploaderLine?: string;
  ffmpegExitCode?: number;
}

async function createFixture(behaviour: Behaviour = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-quick-credit-'));
  roots.push(root);
  const outputDirectory = join(root, 'ra');
  await mkdir(outputDirectory, { recursive: true });
  const file = join(outputDirectory, 'clip [QD-test].mp4');

  const calls: Array<{ tool: string; args: string[] }> = [];
  const processes = {
    run: vi.fn(async (options: RunOptions) => {
      calls.push({ tool: options.tool, args: options.args });

      if (options.tool === 'yt-dlp') {
        await writeFile(file, 'noi-dung-goc');
        if (behaviour.uploaderLine !== undefined) {
          options.onStdoutLine?.(`TUBMEDIA_UPLOADER|${behaviour.uploaderLine}`);
        }
        options.onStdoutLine?.(`TUBMEDIA_FILE|${file}`);
        return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
      }

      if (options.tool === 'ffmpeg') {
        const code = behaviour.ffmpegExitCode ?? 0;
        if (code === 0) await writeFile(options.args.at(-1)!, 'noi-dung-goc');
        return { code, stdoutTail: '', stderrTail: code === 0 ? '' : 'loi ghi metadata', durationMs: 1 };
      }

      return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
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
  return { outputDirectory, file, calls, service };
}

async function run(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Record<string, unknown> = {}
) {
  const started = await fixture.service.start({
    url: 'https://example.com/watch?v=abc123',
    outputDirectory: fixture.outputDirectory,
    quality: 'best',
    mediaMode: 'video-audio',
    mode: 'full',
    accurateCut: false,
    ...overrides
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

describe('Giai đoạn 6 mục 1 — ghi credit vào metadata tệp (không chèn chữ lên hình, không mã hóa lại)', () => {
  it('mặc định BẬT: ghi cả artist (tên kênh) và comment (nguồn + URL + ngày tải) bằng remux -c copy', async () => {
    const fixture = await createFixture({ uploaderLine: 'Kênh Ví Dụ' });
    const status = await run(fixture);

    expect(status.phase).toBe('completed');
    const ffmpeg = fixture.calls.find((call) => call.tool === 'ffmpeg');
    expect(ffmpeg).toBeDefined();
    expect(ffmpeg?.args).toEqual(expect.arrayContaining(['-map', '0', '-c', 'copy']));
    expect(ffmpeg?.args).toContain('artist=Kênh Ví Dụ');
    const commentArg = ffmpeg?.args.find((arg) => arg.startsWith('comment='));
    expect(commentArg).toContain('Nguồn: Kênh Ví Dụ');
    expect(commentArg).toContain('URL: https://example.com/watch?v=abc123');
    expect(commentArg).toContain(`Ngày tải: ${new Date().toISOString().slice(0, 10)}`);
    // -c copy: không có tham số mã hóa lại (không có -crf, -preset, -b:v...).
    expect(ffmpeg?.args.some((arg) => ['-crf', '-preset', '-b:v'].includes(arg))).toBe(false);
  });

  it('không lấy được tên kênh: bỏ qua dòng "Nguồn" và artist, vẫn ghi đủ URL + ngày tải, không lỗi', async () => {
    const fixture = await createFixture({ uploaderLine: '' });
    const status = await run(fixture);

    expect(status.phase).toBe('completed');
    const ffmpeg = fixture.calls.find((call) => call.tool === 'ffmpeg');
    expect(ffmpeg?.args.some((arg) => arg.startsWith('artist='))).toBe(false);
    const commentArg = ffmpeg?.args.find((arg) => arg.startsWith('comment='));
    expect(commentArg).not.toContain('Nguồn:');
    expect(commentArg).toContain('URL: https://example.com/watch?v=abc123');
  });

  it('chế độ đoạn (range): comment có thêm dòng "Đoạn đã cắt" đúng mốc thời gian', async () => {
    const fixture = await createFixture({ uploaderLine: 'Kênh Ví Dụ' });
    const status = await run(fixture, {
      mode: 'range',
      startTime: '00:01:00',
      endTime: '00:02:30',
      accurateCut: true
    });

    expect(status.phase).toBe('completed');
    const ffmpeg = fixture.calls.find((call) => call.tool === 'ffmpeg');
    const commentArg = ffmpeg?.args.find((arg) => arg.startsWith('comment='));
    expect(commentArg).toContain('Đoạn đã cắt: 01:00–02:30');
  });

  it('tải toàn bộ video (mode full): comment KHÔNG có dòng "Đoạn đã cắt"', async () => {
    const fixture = await createFixture({ uploaderLine: 'Kênh Ví Dụ' });
    await run(fixture);

    const ffmpeg = fixture.calls.find((call) => call.tool === 'ffmpeg');
    const commentArg = ffmpeg?.args.find((arg) => arg.startsWith('comment='));
    expect(commentArg).not.toContain('Đoạn đã cắt');
  });

  it('embedCredit=false: không hỏi yt-dlp tên kênh, không gọi ffmpeg ghi metadata', async () => {
    const fixture = await createFixture();
    const status = await run(fixture, { embedCredit: false });

    expect(status.phase).toBe('completed');
    expect(fixture.calls.some((call) => call.tool === 'ffmpeg')).toBe(false);
    expect(await readFile(fixture.file, 'utf8')).toBe('noi-dung-goc');
  });

  it('ffmpeg ghi metadata lỗi: giữ nguyên tệp gốc, báo cảnh báo, không để lại tệp tạm, KHÔNG coi là thất bại', async () => {
    const fixture = await createFixture({ uploaderLine: 'Kênh Ví Dụ', ffmpegExitCode: 1 });
    const status = await run(fixture);

    expect(status.phase).toBe('completed');
    expect(status.warnings.join(' ')).toContain('Không ghi được thông tin nguồn gốc');
    expect(await readFile(fixture.file, 'utf8')).toBe('noi-dung-goc');
    expect(await readdir(fixture.outputDirectory)).toEqual(['clip [QD-test].mp4']);
  });
});
