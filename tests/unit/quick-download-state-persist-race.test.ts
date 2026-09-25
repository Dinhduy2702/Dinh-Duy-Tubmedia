import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  shell: { showItemInFolder: vi.fn() }
}));

/**
 * Lỗi thật gặp trên GitHub Actions khi phát hành v1.4.0 (2026-09-25), KHÔNG lộ ra trên máy cục bộ:
 * ENOENT khi ghi "state.json.<pid>.pending". Nguyên nhân gốc — không phải thiếu mkdir({recursive:true})
 * (persist() đã có sẵn dòng này) mà là một khoảng hở TOCTOU thật giữa mkdir() và writeFile(): nếu một
 * thao tác KHÁC xóa đúng thư mục đó NGAY SAU khi mkdir() vừa tạo xong nhưng TRƯỚC khi writeFile() kịp
 * chạy, writeFile() sẽ ném ENOENT dù mkdir() đã "thành công" ngay trước đó. Bài kiểm này mô phỏng ĐÚNG
 * khoảng hở này bằng cách xen vào chính lệnh gọi mkdir() thật — không đoán, không giả lập bằng cách bỏ
 * qua bước ghi.
 *
 * Vì sao chỉ lộ trên CI: trong bản gốc (đã sửa "app đơ" ở Giai đoạn 6 mục 1), bước ghi credit vào
 * metadata chạy NGẦM (fire-and-forget, dòng embedCreditMetadata().then(() => this.publish(active))
 * trong quick-download-service.ts) — publish() đó gọi lại persist() một lần nữa SAU KHI hàm start() đã
 * trả về. Trên máy phát triển (36 luồng CPU, ổ đĩa rất nhanh), lượt ghi nền này luôn hoàn tất gần như
 * ngay lập tức, không bao giờ chạm đúng khoảnh khắc một tiến trình khác (ví dụ afterEach xóa thư mục tạm
 * của một bài kiểm) đang thao tác cùng thư mục. Trên máy ảo CI (2 lõi, ổ đĩa ảo hóa chậm hơn, cùng lúc
 * chạy nhiều việc), khoảng hở timing giữa mkdir() và writeFile() đủ rộng để một thao tác dọn dẹp khác xen
 * vào đúng lúc — đúng bản chất race condition phụ thuộc tốc độ máy mà không phụ thuộc hệ điều hành (CI
 * cũng chạy windows-latest, không phải khác OS).
 */
let stateDirDeletedOnce = false;
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    mkdir: async (path: Parameters<typeof actual.mkdir>[0], options?: Parameters<typeof actual.mkdir>[1]) => {
      const result = await actual.mkdir(path, options);
      if (!stateDirDeletedOnce && typeof path === 'string' && basename(path) === 'state') {
        stateDirDeletedOnce = true;
        // Mô phỏng ĐÚNG race thật: một thao tác khác xóa thư mục NGAY SAU khi mkdir() vừa tạo xong,
        // trước khi persist() kịp ghi file .pending vào đó.
        await actual.rm(path, { recursive: true, force: true });
      }
      return result;
    }
  };
});

import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  stateDirDeletedOnce = false;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-quick-state-race-'));
  temporaryRoots.push(root);
  const outputDirectory = join(root, 'output');
  const stateDirectory = join(root, 'state');
  await mkdir(outputDirectory, { recursive: true });
  const reported = join(outputDirectory, 'Video [abc] [QD-token].mp4');
  await writeFile(reported, 'video');

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
    stateDirectory
  );
  return { root, outputDirectory, stateDirectory, service, logger };
}

describe('QuickDownloadService: persist() tự phục hồi khi thư mục trạng thái bị xóa giữa chừng', () => {
  it('vẫn ghi được state.json dù thư mục "state" bị xóa NGAY SAU mkdir() nhưng TRƯỚC writeFile()', async () => {
    const fixture = await createFixture();

    const started = await fixture.service.start({
      url: 'https://example.com/video',
      outputDirectory: fixture.outputDirectory,
      quality: 'best' as const,
      mode: 'full' as const,
      startTime: '',
      endTime: '',
      accurateCut: false,
      // Tắt hẳn để cô lập ĐÚNG race của persist() đang kiểm — ghi credit chạy NGẦM (fire-and-forget,
      // xem quick-download-service.ts) là một luồng persist() RIÊNG, không liên quan tới bài kiểm này.
      embedCredit: false
    });

    let status = fixture.service.status(started.taskId);
    for (let attempt = 0; attempt < 200 && status && !['completed', 'failed', 'cancelled'].includes(status.phase); attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      status = fixture.service.status(started.taskId);
    }
    await fixture.service.shutdown(true);

    expect(status?.phase, 'tác vụ phải hoàn tất bình thường dù có xen ngang xóa thư mục trạng thái').toBe(
      'completed'
    );
    expect(stateDirDeletedOnce, 'phải đúng đã xen vào và xóa thư mục trạng thái một lần (xác nhận bài kiểm thật sự tạo ra race, không phải né tránh nó)').toBe(true);

    const state = JSON.parse(await readFile(join(fixture.stateDirectory, 'state.json'), 'utf8')) as {
      statuses: Array<{ taskId: string; phase: string }>;
    };
    expect(
      state.statuses.find((entry) => entry.taskId === started.taskId)?.phase,
      'state.json vẫn phải được ghi đúng và đầy đủ sau khi tự phục hồi khỏi race, không được mất bản ghi'
    ).toBe('completed');
    expect(
      fixture.logger.warn,
      'không được rơi vào nhánh cảnh báo lỗi ghi trạng thái — race phải được tự phục hồi trong persist(), không chỉ ghi log rồi bỏ qua'
    ).not.toHaveBeenCalledWith(
      'quick-download',
      'QUICK_DOWNLOAD_STATE_WRITE_FAILED',
      expect.anything()
    );
  });
});
