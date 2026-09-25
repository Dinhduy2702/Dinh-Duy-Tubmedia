/**
 * Giai đoạn 6 mục 4 (2026-09-24) — "Preset xuất theo nền tảng": MergeEngine.applyAspectRatio() là một
 * bước RIÊNG chạy SAU khi merge() đã commit xong thành phẩm gốc — không đụng tới merge()/checkpoint,
 * nên được kiểm thử độc lập ở đây (đúng tinh thần các hàm/khối logic thuần trong merge-engine.ts đã có,
 * ví dụ decideMergeRecoveryCandidate, applyShortVisualBoundaryPolicy).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MergeEngine } from '../../src/main/merge/merge-engine.js';
import { ProcessCancelledError } from '../../src/shared/errors/app-errors.js';

const roots: string[] = [];

// Rà soát toàn diện (2026-09-24): applyAspectRatio() giờ nhận resource.processPriority (nhất quán với
// bước ghép chính) thay vì cố định 'below_normal' — chỉ cần đúng trường processPriority cho các bài kiểm
// dưới đây, không cần một ResourceProfile đầy đủ.
const STUB_RESOURCE = { processPriority: 'below_normal' } as never;

interface RunOptions {
  args: string[];
  priority?: string;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}

interface Behaviour {
  ffmpegExitCode?: number;
  ffmpegStderrTail?: string;
  verifyOk?: boolean;
  verifyReasons?: string[];
  alreadyValid?: boolean;
  rejectWith?: Error;
}

async function createFixture(behaviour: Behaviour = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-merge-aspect-ratio-'));
  roots.push(root);
  const outputFolder = join(root, 'ra');
  await mkdir(outputFolder, { recursive: true });
  const inputPath = join(root, 'da-ghep.mp4');
  await writeFile(inputPath, 'noi-dung-da-ghep');

  const calls: Array<{ args: string[]; priority?: string | undefined }> = [];
  const processes = {
    run: vi.fn(async (options: RunOptions) => {
      calls.push({ args: options.args, priority: options.priority });
      if (behaviour.rejectWith) throw behaviour.rejectWith;
      const code = behaviour.ffmpegExitCode ?? 0;
      const outputPath = options.args.at(-1)!;
      if (code === 0) await writeFile(outputPath, 'noi-dung-da-doi-ti-le');
      options.onStdoutLine?.('out_time_ms=5000000');
      return {
        code,
        stdoutTail: '',
        stderrTail: code === 0 ? '' : (behaviour.ffmpegStderrTail ?? 'loi ffmpeg'),
        durationMs: 1
      };
    })
  };
  const tools = {
    get: vi.fn(() => ({ name: 'ffmpeg', available: true, executablePath: join(root, 'ffmpeg.exe') }))
  };
  const analyzer = {
    analyze: vi.fn(() => Promise.resolve({ duration: 5, audioCodec: 'aac' }) as never)
  };
  let verifyCallCount = 0;
  const verifier = {
    verify: vi.fn(() => {
      verifyCallCount += 1;
      // Lần gọi đầu là kiểm tra "đã có kết quả hợp lệ từ trước chưa" (resumable) — chỉ trả ok khi test
      // yêu cầu mô phỏng đã có sẵn tệp đích hợp lệ.
      if (verifyCallCount === 1) {
        return Promise.resolve({
          ok: behaviour.alreadyValid ?? false,
          reasons: [],
          duration: 5
        });
      }
      return Promise.resolve({
        ok: behaviour.verifyOk ?? true,
        reasons: behaviour.verifyReasons ?? [],
        duration: 5
      });
    })
  };
  const engine = new MergeEngine(
    tools as never,
    processes as never,
    analyzer as never,
    verifier as never,
    {} as never,
    {} as never,
    {} as never
  );
  return { root, outputFolder, inputPath, calls, engine, processes };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('Giai đoạn 6 mục 4 — MergeEngine.applyAspectRatio (preset xuất theo nền tảng)', () => {
  it('đổi tỉ lệ thành công: tệp mới có hậu tố tỉ lệ trong tên, ffmpeg dùng -filter_complex, giữ nguyên tệp gốc', async () => {
    const fixture = await createFixture();
    const output = await fixture.engine.applyAspectRatio(
      'job-1',
      fixture.inputPath,
      '9:16',
      fixture.outputFolder,
      'Thanh-pham',
      STUB_RESOURCE,
      new AbortController().signal,
      () => undefined
    );
    expect(output).toBe(join(fixture.outputFolder, 'Thanh-pham [9x16].mp4'));
    expect(existsSync(output)).toBe(true);
    expect(existsSync(fixture.inputPath)).toBe(true);

    const call = fixture.calls[0];
    expect(call?.args).toContain('-filter_complex');
    expect(call?.args?.some((arg) => arg.includes('scale=1080:1920'))).toBe(true);
    expect(call?.args).not.toContain('copy');
  });

  it('dùng ĐÚNG resource.processPriority thay vì cố định below_normal (rà soát toàn diện 2026-09-24)', async () => {
    // Trước khi sửa: cố định 'below_normal' bất kể hồ sơ hiệu năng người dùng chọn — không nhất quán với
    // bước ghép chính (dùng resource.processPriority), khiến bước đổi tỉ lệ "chậm lại" ngay sau bước ghép
    // nhanh trên hồ sơ "Toàn bộ hiệu năng".
    const fixture = await createFixture();
    await fixture.engine.applyAspectRatio(
      'job-priority',
      fixture.inputPath,
      '9:16',
      fixture.outputFolder,
      'Thanh-pham',
      { processPriority: 'above_normal' } as never,
      new AbortController().signal,
      () => undefined
    );
    expect(fixture.calls[0]?.priority).toBe('above_normal');
  });

  it('có thể phục hồi: nếu tệp đích đã hợp lệ từ trước, không chạy lại ffmpeg', async () => {
    const fixture = await createFixture({ alreadyValid: true });
    const desired = join(fixture.outputFolder, 'Thanh-pham [1x1].mp4');
    await writeFile(desired, 'da-co-san-tu-truoc');

    const output = await fixture.engine.applyAspectRatio(
      'job-2',
      fixture.inputPath,
      '1:1',
      fixture.outputFolder,
      'Thanh-pham',
      STUB_RESOURCE,
      new AbortController().signal,
      () => undefined
    );
    expect(output).toBe(desired);
    expect(fixture.processes.run).not.toHaveBeenCalled();
  });

  it('ffmpeg lỗi (mã khác 0): ném MergeFailedError, không để lại tệp pending', async () => {
    const fixture = await createFixture({ ffmpegExitCode: 1 });
    await expect(
      fixture.engine.applyAspectRatio(
        'job-3',
        fixture.inputPath,
        '16:9',
        fixture.outputFolder,
        'Thanh-pham',
        STUB_RESOURCE,
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toThrow(/loi ffmpeg/);
    expect(existsSync(join(fixture.outputFolder, 'Thanh-pham [16x9].pending.mp4'))).toBe(false);
  });

  it('ffmpeg lỗi không có stderr: dùng thông điệp dự phòng có kèm mã lỗi', async () => {
    const fixture = await createFixture({ ffmpegExitCode: 137, ffmpegStderrTail: '' });
    await expect(
      fixture.engine.applyAspectRatio(
        'job-3b',
        fixture.inputPath,
        '16:9',
        fixture.outputFolder,
        'Thanh-pham',
        STUB_RESOURCE,
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toThrow(/FFmpeg kết thúc với mã 137/);
  });

  it('xác minh sau khi đổi tỉ lệ không đạt: ném lỗi rõ ràng, không để lại tệp pending', async () => {
    const fixture = await createFixture({ verifyOk: false, verifyReasons: ['thiếu luồng hình'] });
    await expect(
      fixture.engine.applyAspectRatio(
        'job-4',
        fixture.inputPath,
        '9:16',
        fixture.outputFolder,
        'Thanh-pham',
        STUB_RESOURCE,
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toThrow(/thiếu luồng hình/);
    expect(existsSync(join(fixture.outputFolder, 'Thanh-pham [9x16].pending.mp4'))).toBe(false);
  });

  it('bị hủy giữa chừng: lỗi hủy được NÉM ra ngoài (không bị nuốt) — để bộ xử lý tác vụ chung ở queue-manager tự nhận diện signal.aborted và báo đúng \'cancelled\'', async () => {
    const fixture = await createFixture({ rejectWith: new ProcessCancelledError() });
    await expect(
      fixture.engine.applyAspectRatio(
        'job-5',
        fixture.inputPath,
        '9:16',
        fixture.outputFolder,
        'Thanh-pham',
        STUB_RESOURCE,
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toBeInstanceOf(ProcessCancelledError);
  });

  it('tên tệp giữ nguyên phần đuôi .mp4 dù finalFileName đã có sẵn đuôi .mp4', async () => {
    const fixture = await createFixture();
    const output = await fixture.engine.applyAspectRatio(
      'job-6',
      fixture.inputPath,
      '16:9',
      fixture.outputFolder,
      'Thanh-pham.mp4',
      STUB_RESOURCE,
      new AbortController().signal,
      () => undefined
    );
    expect(output).toBe(join(fixture.outputFolder, 'Thanh-pham [16x9].mp4'));
  });
});
