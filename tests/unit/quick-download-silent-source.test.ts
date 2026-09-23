import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  shell: { showItemInFolder: vi.fn() }
}));

import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';
import { AUDIO_STREAM_MISSING_REASON } from '../../src/main/media/file-verifier.js';

const roots: string[] = [];

interface VerifyOptions {
  expectedStreams: { video: boolean; audio: boolean };
}

async function createFixture(verifyResult: (options: VerifyOptions) => { ok: boolean; reasons: string[]; duration: number }) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-quick-silent-'));
  roots.push(root);
  const outputDirectory = join(root, 'output');
  await mkdir(outputDirectory, { recursive: true });

  const processes = {
    run: vi.fn(async (options: { onStdoutLine?: (line: string) => void }) => {
      const file = join(outputDirectory, 'Mars_360 [Mars_360] [QD-test].webm');
      await writeFile(file, 'noi dung gia');
      options.onStdoutLine?.(`TUBMEDIA_FILE|${file}`);
      return { code: 0, stdoutTail: '', stderrTail: '' };
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
  const verifier = {
    verify: vi.fn((_path: string, _level: string, _duration: unknown, options: VerifyOptions) =>
      Promise.resolve(verifyResult(options))
    )
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new QuickDownloadService(
    processes as never,
    tools as never,
    verifier as never,
    logger as never,
    join(root, 'state')
  );
  return { outputDirectory, service, verifier };
}

async function runToEnd(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  mediaMode: 'video-audio' | 'audio-only' | 'video-only'
) {
  const started = await fixture.service.start({
    url: 'https://upload.wikimedia.org/wikipedia/commons/0/05/Mars_360.webm',
    outputDirectory: fixture.outputDirectory,
    quality: 'best',
    mediaMode,
    mode: 'full',
    accurateCut: false,
    // Bài kiểm này chỉ về xác minh luồng âm thanh/hình — tắt credit metadata (Giai đoạn 6 mục 1) để
    // không thêm một lượt gọi ffmpeg không liên quan vào stub processes.run dùng chung ở trên.
    embedCredit: false
  });
  await vi.waitFor(
    () => {
      const phase = fixture.service.status(started.taskId)?.phase;
      expect(['completed', 'failed']).toContain(phase);
    },
    { timeout: 5000 }
  );
  return fixture.service.status(started.taskId)!;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Tải nhanh: video nguồn không có âm thanh', () => {
  it('hoàn tất kèm cảnh báo thay vì thất bại (Mars_360.webm không có kênh âm thanh)', async () => {
    const fixture = await createFixture(({ expectedStreams }) =>
      expectedStreams.audio
        ? { ok: false, reasons: [AUDIO_STREAM_MISSING_REASON], duration: 30.4 }
        : { ok: true, reasons: [], duration: 30.4 }
    );
    const status = await runToEnd(fixture, 'video-audio');

    expect(status.phase).toBe('completed');
    expect(status.error).toBeNull();
    expect(status.warnings.join(' ')).toContain('không có kênh âm thanh');
    expect(status.actualDurationSeconds).toBe(30.4);
    expect(fixture.verifier.verify).toHaveBeenCalledTimes(2);
  });

  it('không cảnh báo và chỉ xác minh một lần khi tệp có âm thanh', async () => {
    const fixture = await createFixture(() => ({ ok: true, reasons: [], duration: 3 }));
    const status = await runToEnd(fixture, 'video-audio');

    expect(status.phase).toBe('completed');
    expect(status.warnings).toEqual([]);
    expect(fixture.verifier.verify).toHaveBeenCalledTimes(1);
  });

  it('vẫn thất bại nếu thiếu âm thanh kèm lỗi khác (tệp hỏng)', async () => {
    const fixture = await createFixture(() => ({
      ok: false,
      reasons: [AUDIO_STREAM_MISSING_REASON, 'Thời lượng không hợp lệ.'],
      duration: 0
    }));
    const status = await runToEnd(fixture, 'video-audio');

    expect(status.phase).toBe('failed');
    expect(status.error).toContain('không đạt kiểm tra');
    expect(fixture.verifier.verify).toHaveBeenCalledTimes(1);
  });

  it('chế độ chỉ âm thanh mà không có âm thanh thì vẫn là thất bại', async () => {
    const fixture = await createFixture(() => ({ ok: false, reasons: [AUDIO_STREAM_MISSING_REASON], duration: 30 }));
    const status = await runToEnd(fixture, 'audio-only');

    expect(status.phase).toBe('failed');
    expect(status.warnings).toEqual([]);
    expect(fixture.verifier.verify).toHaveBeenCalledTimes(1);
  });
});
