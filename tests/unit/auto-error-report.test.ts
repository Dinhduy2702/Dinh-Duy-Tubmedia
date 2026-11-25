import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutoErrorReporter, appFaultSignature } from '../../src/main/diagnostics/auto-error-report.js';

/**
 * 1.8.0: lỗi của ứng dụng tự lưu báo cáo (không mở hộp thoại) vào userData/diagnostics/auto-reports — có giới hạn số tệp /
 * dung lượng, che bí mật, gộp trùng theo chữ ký lỗi trong một phiên.
 */
let folder = '';
const appInfo = (): { appVersion: string; buildCommit: string } => ({ appVersion: '1.8.0-test', buildCommit: 'abc123' });

beforeEach(async () => {
  folder = join(await mkdtemp(join(tmpdir(), 'tm-auto-report-')), 'diagnostics', 'auto-reports');
});
afterEach(async () => {
  await rm(join(folder, '..', '..'), { recursive: true, force: true });
});

function boom(message: string): Error {
  const error = new TypeError(message);
  error.stack = `TypeError: ${message}\n    at QueueManager.execute (C:\\app\\out\\main\\index.js:120:14)\n    at run (C:\\app\\out\\main\\index.js:9:1)`;
  return error;
}

describe('AutoErrorReporter', () => {
  it('lưu một tệp JSON có phiên bản app, nguồn, ngăn xếp lỗi — không mở hộp thoại', async () => {
    const reporter = new AutoErrorReporter(folder, appInfo);
    const result = await reporter.record({ source: 'queue-executor', error: boom('x is undefined'), jobId: 'job-1' });
    expect(result.saved).toBe(true);
    expect(result.duplicate).toBe(false);
    const files = await readdir(folder);
    expect(files).toEqual([result.fileName]);
    const report = JSON.parse(await readFile(join(folder, files[0]!), 'utf8')) as Record<string, unknown>;
    expect(report).toMatchObject({
      appVersion: '1.8.0-test',
      buildCommit: 'abc123',
      source: 'queue-executor',
      jobId: 'job-1',
      error: { name: 'TypeError', message: 'x is undefined' }
    });
    expect(String((report.error as Record<string, unknown>).stack)).toContain('QueueManager.execute');
  });

  it('gộp trùng: cùng chữ ký lỗi trong một phiên chỉ lưu MỘT tệp (số đổi khác nhau vẫn là cùng lỗi)', async () => {
    const reporter = new AutoErrorReporter(folder, appInfo);
    const first = await reporter.record({ source: 'queue-executor', error: boom('item 12 missing') });
    const second = await reporter.record({ source: 'queue-executor', error: boom('item 99 missing') });
    expect(second).toMatchObject({ saved: false, duplicate: true, fileName: first.fileName });
    expect(await readdir(folder)).toHaveLength(1);
    const other = await reporter.record({ source: 'ipc', error: boom('item 12 missing') });
    expect(other.saved).toBe(true);
    expect(await readdir(folder)).toHaveLength(2);
  });

  it('che bí mật: cookie, token, đường dẫn tệp cookies, proxy có mật khẩu', async () => {
    const reporter = new AutoErrorReporter(folder, appInfo);
    const error = new Error(
      'yt-dlp --cookies "C:\\Users\\An\\AppData\\Roaming\\tm\\security\\cookies-run-1.txt" https://x.test/v?token=SECRET123 failed'
    );
    await reporter.record({
      source: 'download-unclassified',
      error,
      context: {
        cookiesFilePath: 'C:\\Users\\An\\cookies.txt',
        proxy: 'http://user:pass@proxy.test:8080',
        note: 'đọc C:\\Users\\An\\Desktop\\www.youtube.com_cookies.txt lỗi',
        header: 'Cookie: SID=abcdef'
      }
    });
    const [file] = await readdir(folder);
    const text = await readFile(join(folder, file!), 'utf8');
    expect(text).not.toContain('SECRET123');
    expect(text).not.toContain('cookies-run-1.txt');
    expect(text).not.toContain('www.youtube.com_cookies.txt');
    expect(text).not.toContain('user:pass');
    expect(text).not.toContain('SID=abcdef');
    expect(text).not.toContain('C:\\\\Users\\\\An\\\\cookies.txt');
  });

  it('giới hạn số tệp: giữ tối đa N tệp, xoá cũ nhất', async () => {
    const reporter = new AutoErrorReporter(folder, appInfo, { maxFiles: 3 });
    const names: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = await reporter.record({ source: 'ipc', error: new Error(`lỗi khác loại ${'abcde'[index]}`) });
      names.push(result.fileName!);
    }
    const files = (await readdir(folder)).sort();
    expect(files).toHaveLength(3);
    expect(files).toEqual(names.slice(2).sort());
  });

  it('giới hạn dung lượng: tổng vượt ngưỡng thì xoá cũ nhất, không bao giờ xoá tệp vừa ghi', async () => {
    const reporter = new AutoErrorReporter(folder, appInfo, { maxBytes: 6_000 });
    await reporter.record({ source: 'ipc', error: new Error('đầu tiên') });
    // Tệp lạ cũ (không phải báo cáo) không bị đụng tới.
    await writeFile(join(folder, 'ghi-chu.txt'), 'x'.repeat(10_000));
    const big = new Error('lớn');
    big.stack = 'Error: lớn\n' + '    at f (a.js:1:1)\n'.repeat(250);
    const latest = await reporter.record({ source: 'renderer', error: big });
    const files = await readdir(folder);
    expect(files).toContain(latest.fileName);
    expect(files).toContain('ghi-chu.txt');
    let total = 0;
    for (const name of files.filter((entry) => entry.endsWith('.json'))) total += (await stat(join(folder, name))).size;
    expect(total).toBeLessThanOrEqual(6_000 + (await stat(join(folder, latest.fileName!))).size);
    expect(files.filter((entry) => entry.endsWith('.json'))).toEqual([latest.fileName]);
  });

  it('không bao giờ ném lỗi ra ngoài (thư mục không ghi được)', async () => {
    await writeFile(join(folder, '..', '..', 'blocker'), 'x').catch(() => undefined);
    const reporter = new AutoErrorReporter(join(folder, '..', '..', 'blocker', 'sub'), appInfo);
    const result = await reporter.record({ source: 'ipc', error: new Error('x') });
    expect(result.saved).toBe(false);
  });

  it('chữ ký bỏ qua số, đường dẫn, mã định danh nhưng phân biệt nguồn và loại lỗi', () => {
    expect(appFaultSignature('ipc', new Error('job 3f2a9c1e-1111-2222-3333-444455556666 at C:\\a\\b.mp4 failed 12'))).toBe(
      appFaultSignature('ipc', new Error('job 9a9a9a9a-1111-2222-3333-444455556666 at D:\\x\\y.mp4 failed 7'))
    );
    expect(appFaultSignature('ipc', new Error('a'))).not.toBe(appFaultSignature('renderer', new Error('a')));
    expect(appFaultSignature('ipc', new Error('a'))).not.toBe(appFaultSignature('ipc', new TypeError('a')));
  });

  it('listForJob trả các báo cáo của đúng tác vụ (để đóng kèm khi Gửi báo cáo lỗi)', async () => {
    const reporter = new AutoErrorReporter(folder, appInfo);
    await reporter.record({ source: 'queue-executor', error: new Error('a'), jobId: 'job-a' });
    await reporter.record({ source: 'queue-executor', error: new Error('b'), jobId: 'job-b' });
    const entries = await reporter.listForJob('job-a');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.data).toContain('"jobId": "job-a"');
  });
});
