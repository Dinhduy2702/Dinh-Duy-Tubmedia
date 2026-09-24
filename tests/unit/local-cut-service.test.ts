import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: { showItemInFolder: vi.fn() }
}));

import { LocalCutService } from '../../src/main/media/local-cut-service.js';
import { ProcessCancelledError } from '../../src/shared/errors/app-errors.js';

const roots: string[] = [];

interface RunOptions {
  tool: string;
  args: string[];
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}

interface VerifyOptions {
  signal?: AbortSignal;
}

interface Behaviour {
  ffmpegExitCode?: number;
  verifyOk?: boolean;
  verifyReasons?: string[];
  neverResolveFfmpeg?: boolean;
  neverResolveVerify?: boolean;
}

async function createFixture(behaviour: Behaviour = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-local-cut-'));
  roots.push(root);
  const outputDirectory = join(root, 'ra');
  await mkdir(outputDirectory, { recursive: true });
  const sourceFile = join(root, 'nguon.mp4');
  await writeFile(sourceFile, 'noi-dung-nguon');

  const calls: Array<{ tool: string; args: string[] }> = [];
  const processes = {
    run: vi.fn(async (options: RunOptions) => {
      calls.push({ tool: options.tool, args: options.args });

      if (behaviour.neverResolveFfmpeg) {
        // Mô phỏng ĐÚNG hành vi thật của ProcessManager.run(): khi bị hủy qua signal, nó THROW
        // ProcessCancelledError — KHÔNG resolve với {code,...}. Bài kiểm hủy giữa chừng bên dưới đã bắt
        // được một lỗi thật (2026-09-24, qua Playwright + Electron thật): trước khi sửa, stub ở đây lại
        // resolve bình thường nên không hề bắt được lỗi — sửa stub khớp thật để không lặp lại sai lầm.
        await new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new ProcessCancelledError()));
        });
        throw new Error('không tới được đây');
      }

      const code = behaviour.ffmpegExitCode ?? 0;
      const outputPath = options.args.at(-1)!;
      if (code === 0) await writeFile(outputPath, 'noi-dung-da-cat');
      options.onStdoutLine?.('out_time_ms=5000000');
      return { code, stdoutTail: '', stderrTail: code === 0 ? '' : 'loi ffmpeg', durationMs: 1 };
    }),
    hasJob: vi.fn(() => false)
  };
  const tools = {
    get: vi.fn((name: string) => ({ name, available: true, executablePath: join(root, `${name}.exe`) }))
  };
  const verifier = {
    verify: vi.fn((_path: string, _level: string, _duration: number | undefined, options: VerifyOptions = {}) => {
      if (behaviour.neverResolveVerify) {
        // Mô phỏng ĐÚNG hành vi thật của FileVerifier.verify(): nó chuyển tiếp signal xuống
        // processes.run() nội bộ (đã xác nhận qua đọc code file-verifier.ts thật), nên khi bị hủy giữa
        // lúc đang xác minh, nó CŨNG ném ProcessCancelledError — không resolve với {ok:false}.
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new ProcessCancelledError()));
        });
      }
      return Promise.resolve({
        ok: behaviour.verifyOk ?? true,
        reasons: behaviour.verifyReasons ?? [],
        duration: 5
      });
    })
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new LocalCutService(processes as never, tools as never, verifier as never, logger as never);

  return { root, outputDirectory, sourceFile, calls, service, verifier };
}

async function waitForTerminal(service: LocalCutService, taskId: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const status = service.status(taskId);
    if (status && ['completed', 'cancelled', 'failed'].includes(status.phase)) return status;
    if (Date.now() - start > timeoutMs) throw new Error('Quá thời gian chờ trạng thái kết thúc.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('Giai đoạn 6 mục 2 — LocalCutService (cắt tệp có sẵn trên máy, không qua tải)', () => {
  it('cắt thành công (sao chép nhanh): tạo tệp mới, không đụng tệp nguồn, tên tệp có mốc thời gian', async () => {
    const fixture = await createFixture();
    const started = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: fixture.outputDirectory,
      startTime: '10',
      endTime: '20',
      accurateCut: false
    });

    const finished = await waitForTerminal(fixture.service, started.taskId);
    expect(finished.phase).toBe('completed');
    expect(finished.outputPath).toContain('[10-20]');
    expect(existsSync(finished.outputPath!)).toBe(true);
    expect(await readFile(fixture.sourceFile, 'utf8')).toBe('noi-dung-nguon');

    const ffmpegCall = fixture.calls.find((call) => call.tool === 'ffmpeg');
    expect(ffmpegCall?.args).toEqual(expect.arrayContaining(['-c', 'copy']));
  });

  it('cắt chính xác (accurateCut=true): gọi ffmpeg với thông số mã hóa lại', async () => {
    const fixture = await createFixture();
    const started = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: fixture.outputDirectory,
      startTime: '0',
      endTime: '5',
      accurateCut: true
    });

    const finished = await waitForTerminal(fixture.service, started.taskId);
    expect(finished.phase).toBe('completed');
    const ffmpegCall = fixture.calls.find((call) => call.tool === 'ffmpeg');
    expect(ffmpegCall?.args).toEqual(expect.arrayContaining(['-c:v', 'libx264']));
  });

  it('từ chối khi tệp nguồn không tồn tại — không gọi ffmpeg', async () => {
    const fixture = await createFixture();
    await expect(
      fixture.service.start({
        filePath: join(fixture.root, 'khong-ton-tai.mp4'),
        outputDirectory: fixture.outputDirectory,
        startTime: '0',
        endTime: '5',
        accurateCut: false
      })
    ).rejects.toThrow(/không tìm thấy tệp nguồn/i);
    expect(fixture.calls).toHaveLength(0);
  });

  it('báo lỗi rõ ràng khi thư mục lưu kết quả không tồn tại (kiểm tra lại phía main, không chỉ tin UI)', async () => {
    const fixture = await createFixture();
    const started = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: join(fixture.root, 'khong-ton-tai'),
      startTime: '0',
      endTime: '5',
      accurateCut: false
    });
    const finished = await waitForTerminal(fixture.service, started.taskId);
    expect(finished.phase).toBe('failed');
    expect(finished.error).toContain('Thư mục lưu kết quả không tồn tại');
  });

  it('từ chối chạy đồng thời hai lượt cắt', async () => {
    const fixture = await createFixture();
    const first = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: fixture.outputDirectory,
      startTime: '0',
      endTime: '5',
      accurateCut: false
    });
    expect(fixture.service.isActive()).toBe(true);

    await expect(
      fixture.service.start({
        filePath: fixture.sourceFile,
        outputDirectory: fixture.outputDirectory,
        startTime: '0',
        endTime: '5',
        accurateCut: false
      })
    ).rejects.toThrow(/đang chạy/);

    await waitForTerminal(fixture.service, first.taskId);
    expect(fixture.service.isActive()).toBe(false);
  });

  it('ffmpeg lỗi (mã khác 0): phase failed, không có tệp .pending sót lại', async () => {
    const fixture = await createFixture({ ffmpegExitCode: 1 });
    const started = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: fixture.outputDirectory,
      startTime: '0',
      endTime: '5',
      accurateCut: false
    });
    const finished = await waitForTerminal(fixture.service, started.taskId);
    expect(finished.phase).toBe('failed');
    expect(finished.outputPath).toBeNull();
  });

  it('xác minh tệp đầu ra không đạt: phase failed, có lý do rõ ràng', async () => {
    const fixture = await createFixture({ verifyOk: false, verifyReasons: ['thiếu luồng hình'] });
    const started = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: fixture.outputDirectory,
      startTime: '0',
      endTime: '5',
      accurateCut: false
    });
    const finished = await waitForTerminal(fixture.service, started.taskId);
    expect(finished.phase).toBe('failed');
    expect(finished.error).toContain('thiếu luồng hình');
  });

  it('hủy giữa chừng: phase cancelled, không để lại tệp đầu ra', async () => {
    const fixture = await createFixture({ neverResolveFfmpeg: true });
    const started = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: fixture.outputDirectory,
      startTime: '0',
      endTime: '5',
      accurateCut: false
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    await fixture.service.cancel(started.taskId);

    const finished = await waitForTerminal(fixture.service, started.taskId);
    expect(finished.phase).toBe('cancelled');
    expect(finished.outputPath).toBeNull();
  });

  it('hủy giữa chừng NGAY LÚC ĐANG XÁC MINH (sau khi cắt xong): vẫn phải là cancelled, không báo nhầm failed', async () => {
    // Rà soát toàn diện (2026-09-24) — lỗi thật tìm được: bản sửa lỗi hủy giữa chừng ở mục 2 chỉ bọc
    // quanh bước ffmpeg CẮT, chưa bọc quanh bước gọi verifier.verify() ngay sau đó — verify() cũng ném
    // ProcessCancelledError khi bị hủy giữa chừng (nó chuyển tiếp signal xuống processes.run() nội bộ),
    // nên trước khi sửa, hủy đúng lúc đang "verifying" sẽ lọt qua catch chung và bị báo nhầm "failed".
    const fixture = await createFixture({ neverResolveVerify: true });
    const started = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: fixture.outputDirectory,
      startTime: '0',
      endTime: '5',
      accurateCut: false
    });

    // Đợi tới khi service thực sự đang ở phase 'verifying' rồi mới hủy — đúng cửa sổ hẹp cần tái hiện.
    const verifyingDeadline = Date.now() + 5000;
    while (fixture.service.status(started.taskId)?.phase !== 'verifying') {
      if (Date.now() > verifyingDeadline) throw new Error('Quá thời gian chờ phase verifying.');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await fixture.service.cancel(started.taskId);

    const finished = await waitForTerminal(fixture.service, started.taskId);
    expect(finished.phase).toBe('cancelled');
    expect(finished.error).toBeNull();
  });

  it('previewFrame: gọi đúng ffmpeg trên tệp cục bộ, không cần yt-dlp', async () => {
    const fixture = await createFixture();
    const result = await fixture.service.previewFrame({ filePath: fixture.sourceFile, timestampSeconds: 3 });
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(fixture.calls.some((call) => call.tool === 'yt-dlp')).toBe(false);
  });

  it('previewFrame: báo lỗi rõ ràng nếu tệp không tồn tại', async () => {
    const fixture = await createFixture();
    await expect(
      fixture.service.previewFrame({ filePath: join(fixture.root, 'khong-co.mp4'), timestampSeconds: 1 })
    ).rejects.toThrow(/không tìm thấy tệp nguồn/i);
  });
});

describe('Giai doan 6 muc 3 (2026-09-24) - LocalCutService: doi ti le khung hinh (nen mo kieu CapCut)', () => {
  it('aspectRatio khac original: ten tep co hau to ti le, ffmpeg dung -filter_complex, duoi .mp4 du accurateCut=false', async () => {
    const fixture = await createFixture();
    const started = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: fixture.outputDirectory,
      startTime: '10',
      endTime: '20',
      accurateCut: false,
      aspectRatio: '9:16'
    });

    const finished = await waitForTerminal(fixture.service, started.taskId);
    expect(finished.phase).toBe('completed');
    expect(finished.aspectRatio).toBe('9:16');
    expect(finished.outputPath).toContain('[9x16]');
    expect(finished.outputPath).toMatch(/\.mp4$/);

    const ffmpegCall = fixture.calls.find((call) => call.tool === 'ffmpeg');
    expect(ffmpegCall?.args).toContain('-filter_complex');
    expect(ffmpegCall?.args).not.toContain('copy');
  });

  it('aspectRatio original: ten tep KHONG co hau to ti le (tuong thich nguoc, giu dung hanh vi muc 2)', async () => {
    const fixture = await createFixture();
    const started = await fixture.service.start({
      filePath: fixture.sourceFile,
      outputDirectory: fixture.outputDirectory,
      startTime: '10',
      endTime: '20',
      accurateCut: false
    });
    const finished = await waitForTerminal(fixture.service, started.taskId);
    expect(finished.phase).toBe('completed');
    expect(finished.aspectRatio).toBe('original');
    expect(finished.outputPath).not.toContain('[9x16]');
    expect(finished.outputPath).not.toMatch(/\[\d+x\d+\]/);
  });

  it('previewFrame: truyen aspectRatio xuong dung lenh ffmpeg trich khung hinh', async () => {
    const fixture = await createFixture();
    await fixture.service.previewFrame({ filePath: fixture.sourceFile, timestampSeconds: 3, aspectRatio: '1:1' });
    const frameCall = fixture.calls.find((call) => call.tool === 'ffmpeg');
    expect(frameCall?.args).toContain('-filter_complex');
    expect(frameCall?.args?.some((arg) => arg.includes('scale=1080:1080'))).toBe(true);
  });
});
