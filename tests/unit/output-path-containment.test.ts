import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  shell: { showItemInFolder: vi.fn() }
}));

import { acceptPathInside, isInside } from '../../src/main/files/path-containment.js';
import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';
import type { QuickDownloadStatus } from '../../src/shared/quick-download.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

describe('isInside', () => {
  const folder = join(tmpdir(), 'tubmedia-containment', 'nguon');

  it('chấp nhận tệp và thư mục con bên trong', () => {
    expect(isInside(folder, join(folder, 'video.mp4'))).toBe(true);
    expect(isInside(folder, join(folder, 'con', 'video.mp4'))).toBe(true);
    expect(isInside(folder, folder)).toBe(true);
  });

  it('từ chối thư mục anh em có tiền tố giống nhau, thư mục cha và ổ đĩa khác', () => {
    expect(isInside(folder, `${folder}-khac${resolve('/')[0] === '/' ? '/' : '\\'}video.mp4`)).toBe(false);
    expect(isInside(folder, join(folder, '..', 'video.mp4'))).toBe(false);
    expect(isInside(folder, join(folder, '..'))).toBe(false);
    if (process.platform === 'win32') {
      expect(isInside('C:\\Videos\\nguon', 'D:\\Videos\\nguon\\a.mp4')).toBe(false);
      expect(isInside('C:\\Videos\\nguon', 'c:\\videos\\NGUON\\a.mp4')).toBe(true);
      expect(isInside('C:\\Videos\\nguon', '\\\\server\\share\\a.mp4')).toBe(false);
    }
  });

  it('không nhầm tệp có tên bắt đầu bằng hai dấu chấm với thư mục cha', () => {
    expect(isInside(folder, join(folder, '...và công lý [abc].mp4'))).toBe(true);
    expect(isInside(folder, join(folder, '..ẩn.mp4'))).toBe(true);
  });
});

describe('acceptPathInside', () => {
  const folder = join(tmpdir(), 'tubmedia-containment', 'nguon');

  it('trả lại đúng chuỗi đã nhận khi tệp nằm hẳn bên trong', () => {
    const reported = join(folder, 'Tiêu đề [abc].mp4');
    expect(acceptPathInside(folder, reported)).toBe(reported);
  });

  it.each([
    ['rỗng', ''],
    ['chỉ khoảng trắng', '   '],
    ['chứa NUL', join(tmpdir(), 'tubmedia-containment', 'nguon', 'a\0b.mp4')],
    ['chính thư mục đích', join(tmpdir(), 'tubmedia-containment', 'nguon')],
    ['thoát bằng ..', join(tmpdir(), 'tubmedia-containment', 'nguon', '..', 'nguon-khac', 'x.mp4')],
    ['thư mục khác', join(tmpdir(), 'noi-khac', 'x.mp4')]
  ])('từ chối %s', (_label, reported) => {
    expect(acceptPathInside(folder, reported)).toBeNull();
  });
});

describe('luồng tải chính', () => {
  it('lọc đường dẫn __VDMSP_FILE__ qua acceptPathInside với thư mục nguồn của danh sách', () => {
    const engine = readFileSync(resolve(process.cwd(), 'src/main/downloader/download-engine.ts'), 'utf8');
    expect(engine).toContain('acceptPathInside(project.sourceFolder, reportedPath)');
    expect(engine).toContain('YTDLP_OUTPUT_PATH_REJECTED');
    expect(engine).not.toMatch(/finalPath = line\.slice\('__VDMSP_FILE__:'\.length\)\.trim\(\)/);
  });
});

async function runQuickDownload(reportedFile: (outputDirectory: string) => string, createReported: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-quick-containment-'));
  temporaryRoots.push(root);
  const outputDirectory = join(root, 'output');
  await mkdir(outputDirectory, { recursive: true });
  const reported = reportedFile(outputDirectory);
  if (createReported) await writeFile(reported, 'video');

  const processes = {
    run: vi.fn((options: { onStdoutLine?: (line: string) => void }) => {
      options.onStdoutLine?.(`TUBMEDIA_FILE|${reported}`);
      return Promise.resolve({ code: 0, stdoutTail: '', stderrTail: '' });
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
  const verifier = { verify: vi.fn(() => Promise.resolve({ ok: true, reasons: [], duration: 300 })) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new QuickDownloadService(
    processes as never,
    tools as never,
    verifier as never,
    logger as never,
    join(root, 'state')
  );
  const started = await service.start({
    url: 'https://example.com/video',
    outputDirectory,
    quality: 'best' as const,
    mode: 'full' as const,
    startTime: '',
    endTime: '',
    accurateCut: false
  });

  let status: QuickDownloadStatus | null = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    status = service.status(started.taskId);
    if (status && ['completed', 'failed', 'cancelled', 'interrupted'].includes(status.phase)) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  await service.shutdown(true); // chờ ghi trạng thái xong trước khi xóa thư mục tạm
  return { status: status as QuickDownloadStatus, logger, reported, outputDirectory, verifier };
}

describe('QuickDownloadService: đường dẫn tệp do yt-dlp báo về', () => {
  it('từ chối đường dẫn nằm ngoài thư mục đích và không dùng nó làm tệp thành phẩm', async () => {
    const outside = join(tmpdir(), `tubmedia-outside-${Date.now()}.mp4`);
    const result = await runQuickDownload(() => outside, false);
    expect(result.status.outputPath).not.toBe(outside);
    expect(result.verifier.verify).not.toHaveBeenCalledWith(outside, expect.anything(), expect.anything(), expect.anything());
    expect(result.logger.warn).toHaveBeenCalledWith(
      'quick-download',
      'OUTPUT_PATH_REJECTED',
      expect.any(String),
      expect.objectContaining({ metadata: { reportedPath: outside } })
    );
  });

  it('vẫn nhận đường dẫn hợp lệ nằm trong thư mục đích', async () => {
    const result = await runQuickDownload((directory) => join(directory, 'Video [abc] [QD-token].mp4'), true);
    expect(result.status.phase).toBe('completed');
    expect(result.status.outputPath).toBe(result.reported);
    expect(result.logger.warn).not.toHaveBeenCalledWith(
      'quick-download',
      'OUTPUT_PATH_REJECTED',
      expect.anything(),
      expect.anything()
    );
  });
});
