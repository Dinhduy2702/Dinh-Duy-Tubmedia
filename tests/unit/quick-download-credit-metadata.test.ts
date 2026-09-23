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
  ffmpegDelayMs?: number;
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
        if (behaviour.ffmpegDelayMs) await new Promise((r) => setTimeout(r, behaviour.ffmpegDelayMs));
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

  // Sửa lỗi 2026-09-23 (Vấn đề 2 — app đơ): ghi credit giờ chạy NGẦM SAU KHI phase đã là 'completed'
  // (không còn chặn "hoàn tất" nữa — chính là điều đang được kiểm ở đây). Vì vậy các bài kiểm phía dưới
  // cần đợi RIÊNG cho tới khi bước ngầm này thực sự chạy xong, không thể suy ra từ status.phase nữa.
  const embedCredit = (overrides as { embedCredit?: boolean }).embedCredit !== false;
  if (embedCredit) {
    await vi.waitFor(() => expect(fixture.calls.some((call) => call.tool === 'ffmpeg')).toBe(true), {
      timeout: 5000
    });
  }

  return fixture.service.status(started.taskId)!;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Sửa lỗi (2026-09-23) — Vấn đề 2: ghi credit KHÔNG được chặn "hoàn tất" (app đơ)', () => {
  it('phase đạt "completed" gần như ngay lập tức, KHÔNG đợi hết thời gian chạy của bước ghi credit (ffmpeg)', async () => {
    // Cố ý làm ffmpeg (bước ghi credit) chậm 400ms. Nếu code CHẶN (bug cũ — await trước khi báo hoàn
    // tất) thì phase chỉ đạt 'completed' SAU khi đã trôi qua >= 400ms. Nếu đã sửa (chạy nền), phase đạt
    // 'completed' gần như ngay (vài chục ms, chỉ mất thời gian xác minh tệp), độc lập với độ trễ ffmpeg.
    const fixture = await createFixture({ uploaderLine: 'Kênh Ví Dụ', ffmpegDelayMs: 400 });

    const t0 = Date.now();
    const started = await fixture.service.start({
      url: 'https://example.com/watch?v=abc123',
      outputDirectory: fixture.outputDirectory,
      quality: 'best',
      mediaMode: 'video-audio',
      mode: 'full',
      accurateCut: false
    });

    await vi.waitFor(
      () => expect(fixture.service.status(started.taskId)?.phase).toBe('completed'),
      { timeout: 5000 }
    );
    const elapsedToCompleted = Date.now() - t0;
    console.log('  [đo thật] thời gian tới khi "completed":', elapsedToCompleted, 'ms (độ trễ ffmpeg cố ý: 400ms)');

    // Đây là quả quyết chính: KHÔNG đợi hết 400ms của bước ghi credit mới báo hoàn tất.
    expect(elapsedToCompleted).toBeLessThan(400);

    // Dọn dẹp: chờ bước ngầm thực sự chạy xong trước khi kết thúc bài kiểm.
    await vi.waitFor(() => expect(fixture.calls.some((call) => call.tool === 'ffmpeg')).toBe(true), {
      timeout: 5000
    });
  });

  it('sau khi "hoàn tất", mọi nút coi như KHÔNG còn "running" — running chỉ dựa vào phase, không đợi bước credit ngầm', async () => {
    const fixture = await createFixture({ uploaderLine: 'Kênh Ví Dụ', ffmpegDelayMs: 300 });
    const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'skipped', 'interrupted']);

    const started = await fixture.service.start({
      url: 'https://example.com/watch?v=abc123',
      outputDirectory: fixture.outputDirectory,
      quality: 'best',
      mediaMode: 'video-audio',
      mode: 'full',
      accurateCut: false
    });

    await vi.waitFor(() => expect(fixture.service.status(started.taskId)?.phase).toBe('completed'), {
      timeout: 5000
    });

    // Giao diện coi "running" = !TERMINAL_PHASES.has(phase) — phải đúng ngay cả khi bước credit ngầm
    // vẫn đang chạy phía sau (đây chính là điều Vấn đề 2 báo sai: "không bấm được bất kỳ nút nào").
    const status = fixture.service.status(started.taskId)!;
    expect(TERMINAL.has(status.phase)).toBe(true);
  });
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
    const started = await run(fixture);
    expect(started.phase).toBe('completed');

    // Cảnh báo chỉ xuất hiện sau khi bước ghi credit NGẦM thật sự xử lý xong lỗi — đợi riêng, không
    // suy ra từ phase (đã 'completed' từ trước khi bước ngầm này kịp chạy).
    await vi.waitFor(
      () => expect(fixture.service.status(started.taskId)?.warnings.join(' ')).toContain('Không ghi được thông tin nguồn gốc'),
      { timeout: 5000 }
    );

    expect(await readFile(fixture.file, 'utf8')).toBe('noi-dung-goc');
    expect(await readdir(fixture.outputDirectory)).toEqual(['clip [QD-test].mp4']);
  });
});
