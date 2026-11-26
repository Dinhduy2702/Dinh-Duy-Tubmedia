import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diagnoseToolHealthFailure,
  formatToolHealthFailureMessage
} from '../../src/shared/utils/tool-diagnosis.js';
import { parseUserActionMessage } from '../../src/shared/utils/user-action-message.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';
import { ToolNotFoundError } from '../../src/shared/errors/app-errors.js';
import { ToolManager } from '../../src/main/tools/tool-manager.js';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('v1.8.1 — chẩn đoán lỗi công cụ cụ thể theo nguyên nhân thật (CPU quá tải / diệt virus / hỏng tệp / thiếu tệp)', () => {
  it('khi tệp có tồn tại nhưng kiểm tra quá giờ lúc CPU cao: nêu rõ % CPU, số việc đang chạy và hướng giảm tải', () => {
    const diagnosis = diagnoseToolHealthFailure({
      tool: 'yt-dlp',
      hasExistingBinary: true,
      failures: ['C:\\Users\\Giap\\AppData\\Roaming\\tools\\yt-dlp.exe: Tiến trình quá thời gian chờ (timeout 35000 ms)'],
      load: { cpuPercent: 100, activeJobs: 15 }
    });
    expect(diagnosis.cause).toBe('cpu_overload_timeout');

    const message = formatToolHealthFailureMessage(diagnosis);
    const parsed = parseUserActionMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toMatch(/CPU|quá tải|chậm/i);
    expect(parsed!.summary).toContain('100%');
    expect(parsed!.summary).toContain('15');
    expect(parsed!.steps.join(' ')).toMatch(/Tạm dừng tất cả/i);
    expect(parsed!.steps.join(' ')).toMatch(/Cài đặt ›/);

    const issue = friendlyIssue(message);
    expect(issue.kind).toBe('user-action');
    expect(issue.action).toEqual({ label: 'Mở Cài đặt', page: 'settings' });
  });

  it('khi bị Windows hoặc phần mềm diệt virus chặn chạy: nêu rõ nguyên nhân bị chặn và cách xử lý', () => {
    const diagnosis = diagnoseToolHealthFailure({
      tool: 'yt-dlp',
      hasExistingBinary: true,
      failures: ['C:\\tools\\yt-dlp.exe: spawn EACCES (Access is denied)']
    });
    expect(diagnosis.cause).toBe('permission_or_antivirus');

    const message = formatToolHealthFailureMessage(diagnosis);
    const parsed = parseUserActionMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toMatch(/chặn|diệt virus|quyền/i);
  });

  it('khi tệp tồn tại nhưng chạy lỗi exit code != 0: báo tệp có sẵn nhưng chạy bị lỗi, gợi ý Khôi phục / Sửa chữa', () => {
    const diagnosis = diagnoseToolHealthFailure({
      tool: 'yt-dlp',
      hasExistingBinary: true,
      failures: ['C:\\tools\\yt-dlp.exe: Kiểm tra phiên bản thất bại (exit 1).']
    });
    expect(diagnosis.cause).toBe('corrupted_or_failed');

    const message = formatToolHealthFailureMessage(diagnosis);
    const parsed = parseUserActionMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed!.steps.join(' ')).toMatch(/Khôi phục|Sửa chữa tất cả/);
  });

  it('chỉ khi thật sự không có tệp công cụ nào trên máy mới báo chưa tìm thấy tệp', () => {
    const diagnosis = diagnoseToolHealthFailure({
      tool: 'aria2c',
      hasExistingBinary: false,
      failures: ['aria2c: spawn aria2c ENOENT']
    });
    expect(diagnosis.cause).toBe('missing');

    const message = formatToolHealthFailureMessage(diagnosis);
    const parsed = parseUserActionMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toMatch(/Chưa tìm thấy tệp/i);
  });

  it('ToolNotFoundError giữ nguyên thông báo chẩn đoán cụ thể khi được truyền vào thay vì ép thành câu chung chung', () => {
    const specific = formatToolHealthFailureMessage(
      diagnoseToolHealthFailure({
        tool: 'yt-dlp',
        hasExistingBinary: true,
        failures: ['yt-dlp.exe: Quá thời gian chờ (timed out)'],
        load: { cpuPercent: 99, activeJobs: 12 }
      })
    );
    const err = new ToolNotFoundError('yt-dlp', specific);
    expect(err.code).toBe('TOOL_NOT_FOUND');
    expect(err.message).toBe(specific);
    const issue = friendlyIssue(err);
    expect(issue.kind).toBe('user-action');
    expect(issue.message).toContain('99%');
    expect(issue.message).not.toBe('Một công cụ bắt buộc chưa sẵn sàng. Hàng đợi đã được giữ nguyên để tránh tạo lỗi hàng loạt.');
  });

  it('ToolManager kiểm tra yt-dlp với priority normal, timeout >= 30s và trả lỗi nêu rõ CPU 100% khi bị timeout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tubmedia-tool-cpu-'));
    tempDirs.push(root);
    const bundledDir = join(root, 'resources', 'tool');
    mkdirSync(bundledDir, { recursive: true });
    writeFileSync(join(bundledDir, 'yt-dlp.exe'), 'fake-binary');

    const runCalls: Array<{ priority: string | undefined; timeoutMs: number | undefined }> = [];
    const processes = {
      run: vi.fn((opts: { priority?: string; timeoutMs?: number }) => {
        runCalls.push({ priority: opts.priority, timeoutMs: opts.timeoutMs });
        return Promise.reject(new Error('Tiến trình vượt quá thời gian chờ (timeout).'));
      })
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const manager = new ToolManager(
      processes as never,
      logger as never,
      () => defaultAppSettings,
      join(root, 'resources'),
      join(root, 'userData'),
      join(root, 'app'),
      true
    );
    manager.setSystemLoadProvider(() => ({ cpuPercent: 100, activeJobs: 15 }));

    const statuses = await manager.healthCheck('yt-dlp');
    const ytdlp = statuses.find((item) => item.name === 'yt-dlp');
    expect(ytdlp?.available).toBe(false);
    expect(runCalls.length).toBeGreaterThan(0);
    expect(runCalls[0]?.priority).toBe('normal');
    expect(runCalls[0]?.timeoutMs ?? 0).toBeGreaterThanOrEqual(30_000);
    expect(ytdlp?.error).toContain('100%');
    expect(ytdlp?.error).toContain('15');
    expect(parseUserActionMessage(ytdlp?.error ?? '')).not.toBeNull();
  });

  it('ToolsPage hiển thị lỗi công cụ ngay khi công cụ đó kiểm tra xong (không ẩn vì công cụ khác đang kiểm) và dùng FriendlyIssueCard', () => {
    const toolsPage = readFileSync(join(process.cwd(), 'src/renderer/src/pages/ToolsPage.tsx'), 'utf8');
    expect(toolsPage).toContain('FriendlyIssueCard');
    expect(toolsPage).toContain('tool.lastCheckedAt !== null');
    expect(toolsPage).not.toContain('{tool.error && !connecting');
  });
});
