import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runShutdownSequence, type ShutdownStep } from '@main/app/shutdown-sequence.js';

// Người dùng báo sau phát hành 1.6.0 (2026-10-06): bấm X (đã xác nhận là X, không phải "—") nhưng app không thoát hẳn,
// phải End Task. 11 lần thử thật đều thoát < 1s nên chưa tái hiện; điểm yếu đã thấy trong mã: before-quit chờ từng bước
// dọn dẹp KHÔNG giới hạn thời gian (queue.stop chờ tác vụ trước khi giết tiến trình con) và không ghi gì khi thoát.

const hang = (): Promise<void> => new Promise<void>(() => undefined);

describe('runShutdownSequence — dọn dẹp khi thoát không bao giờ treo', () => {
  it('một bước treo: bị cắt sau đúng giới hạn của nó, các bước sau VẪN chạy', async () => {
    const ran: string[] = [];
    const trail: string[] = [];
    const steps: ShutdownStep[] = [
      { name: 'quickDownload', timeoutMs: 50, run: () => { ran.push('quickDownload'); } },
      { name: 'queue', timeoutMs: 80, run: hang },
      { name: 'processes', timeoutMs: 50, run: () => { ran.push('processes'); } }
    ];
    const started = Date.now();
    const report = await runShutdownSequence(steps, { totalTimeoutMs: 1_000, trail: (line) => trail.push(line) });

    expect(Date.now() - started).toBeLessThan(600);
    expect(ran).toEqual(['quickDownload', 'processes']);
    expect(report.steps.map((step) => `${step.name}:${step.status}`)).toEqual(['quickDownload:ok', 'queue:timeout', 'processes:ok']);
    expect(report.forced).toBe(false);
    expect(trail.some((line) => line.includes('queue') && line.includes('QUÁ GIỜ'))).toBe(true);
  });

  it('một bước ném lỗi: ghi lại lỗi rồi chạy tiếp', async () => {
    const report = await runShutdownSequence(
      [
        { name: 'logger', timeoutMs: 50, run: () => { throw new Error('ổ đầy'); } },
        { name: 'database', timeoutMs: 50, run: () => undefined }
      ],
      { totalTimeoutMs: 1_000, trail: () => undefined }
    );
    expect(report.steps.map((step) => step.status)).toEqual(['error', 'ok']);
    expect(report.steps[0]!.error).toContain('ổ đầy');
  });

  it('tổng quá giới hạn: bỏ qua các bước còn lại và báo buộc thoát', async () => {
    const trail: string[] = [];
    const started = Date.now();
    const report = await runShutdownSequence(
      [
        { name: 'a', timeoutMs: 5_000, run: hang },
        { name: 'b', timeoutMs: 5_000, run: () => undefined }
      ],
      { totalTimeoutMs: 120, trail: (line) => trail.push(line) }
    );
    expect(Date.now() - started).toBeLessThan(600);
    expect(report.steps.map((step) => `${step.name}:${step.status}`)).toEqual(['a:timeout', 'b:skipped']);
    expect(report.forced).toBe(true);
  });
});

describe('index.ts dùng chuỗi dọn dẹp có giới hạn + nhật ký thoát', () => {
  const index = readFileSync('src/main/index.ts', 'utf8');
  const beforeQuit = index.slice(index.indexOf("app.on('before-quit'"));

  it('before-quit chạy qua runShutdownSequence, tổng 15 giây, có chốt chặn buộc thoát độc lập', () => {
    expect(beforeQuit).toContain('runShutdownSequence(');
    expect(index).toContain('SHUTDOWN_TOTAL_TIMEOUT_MS = 15_000');
    expect(beforeQuit).toMatch(/setTimeout\([\s\S]*?app\.exit\(0\)/);
  });

  it('ghi nhật ký thoát đồng bộ ra logs\\shutdown.log (bắt đầu / từng bước / xong)', () => {
    expect(index).toContain("'shutdown.log'");
    expect(beforeQuit).toContain('BẮT ĐẦU THOÁT');
    expect(beforeQuit).toContain('THOÁT XONG');
  });

  it('đường cài bản cập nhật cũng dùng các bước có giới hạn thời gian', () => {
    const prepare = index.slice(index.indexOf('const prepareForAppUpdate'), index.indexOf('const current = new AppContext'));
    expect(prepare).toContain('runShutdownSequence(');
  });
});
