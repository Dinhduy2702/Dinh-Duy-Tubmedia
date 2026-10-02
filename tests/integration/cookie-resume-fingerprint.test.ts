import { afterEach, describe, expect, it } from 'vitest';
import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';
import { computeCookieFingerprint } from '@main/cookies/cookie-fingerprint.js';
import { redactSecrets } from '@shared/utils/secret-redaction.js';
import type { QueueJob } from '@shared/types/domain.js';

type ExecuteAccess = { execute: (job: QueueJob, profile: unknown, signal: AbortSignal) => Promise<void> };

let harness: QueueHarness | null = null;
afterEach(() => {
  harness?.cleanup();
  harness = null;
});

const COOKIES_A = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSID\tgia-tri-a\n';
const COOKIES_B = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSID\tgia-tri-b\n';

function withCookieFile(content: string): { harness: QueueHarness; file: string } {
  const h = createQueueHarness();
  const file = join(h.folder, 'cookies.txt');
  writeFileSync(file, content, 'utf8');
  h.settings.cookiesFilePath = file;
  return { harness: h, file };
}

/** Chặn tác vụ đúng như thật: execute() gặp COOKIES_EXPIRED → tạm dừng và lưu dấu vân tay cookies. */
async function blockWithExpiredCookies(h: QueueHarness): Promise<QueueJob> {
  h.downloader.run.mockRejectedValueOnce(Object.assign(new Error('Cookies hết hạn'), { code: 'COOKIES_EXPIRED' }));
  const job = h.jobIn('pending');
  await (h.manager as unknown as ExecuteAccess).execute(job, {}, new AbortController().signal);
  const blocked = h.queue.get(job.id)!;
  expect(blocked.status).toBe('paused');
  expect(blocked.errorCode).toBe('COOKIES_EXPIRED');
  return blocked;
}

const autoResumedLogged = (h: QueueHarness): boolean =>
  h.logger.info.mock.calls.some((call) => call[1] === 'COOKIE_BLOCKS_AUTO_RESUMED');

describe('cookies: chỉ tự chạy lại khi nội dung cookies thật sự đổi', () => {
  it('lưu lại tệp cookies với nội dung giống cũ (mtime đổi) thì KHÔNG chạy lại', async () => {
    const setup = withCookieFile(COOKIES_A);
    harness = setup.harness;
    const blocked = await blockWithExpiredCookies(harness);

    writeFileSync(setup.file, COOKIES_A, 'utf8');
    const later = new Date(Date.now() + 60_000);
    utimesSync(setup.file, later, later);

    expect(await harness.manager.resumeCookieBlockedJobs('cookies-saved')).toBe(0);
    expect(harness.queue.get(blocked.id)?.status).toBe('paused');
    expect(autoResumedLogged(harness)).toBe(false);
  });

  it('nội dung cookies mới thì chạy lại và mới ghi "Cookies mới đã được lưu"', async () => {
    const setup = withCookieFile(COOKIES_A);
    harness = setup.harness;
    const blocked = await blockWithExpiredCookies(harness);

    writeFileSync(setup.file, COOKIES_B, 'utf8');

    expect(await harness.manager.resumeCookieBlockedJobs('cookies-saved')).toBe(1);
    expect(harness.queue.get(blocked.id)?.status).toBe('pending');
    expect(autoResumedLogged(harness)).toBe(true);
  });

  it('khởi động lại mà cookies không đổi thì không đưa tác vụ bị chặn vào hàng chờ, không hỏi', async () => {
    const setup = withCookieFile(COOKIES_A);
    harness = setup.harness;
    const blocked = await blockWithExpiredCookies(harness);

    harness.relaunch();
    await harness.manager.start();

    expect(harness.queue.get(blocked.id)?.status).toBe('paused');
    expect(harness.queue.get(blocked.id)?.errorCode).toBe('COOKIES_EXPIRED');
    expect((await harness.manager.consumeStartupPrompt()).count).toBe(0);
    expect(autoResumedLogged(harness)).toBe(false);
  });

  it('khởi động lại sau khi cookies đổi: tác vụ đủ điều kiện được tính vào N, chưa tự chạy', async () => {
    const setup = withCookieFile(COOKIES_A);
    harness = setup.harness;
    const blocked = await blockWithExpiredCookies(harness);
    writeFileSync(setup.file, COOKIES_B, 'utf8');

    harness.relaunch();
    await harness.manager.start();

    expect(harness.queue.get(blocked.id)?.status).toBe('paused');
    expect(harness.queue.get(blocked.id)?.errorCode).toBe('APP_INTERRUPTED');
    expect((await harness.manager.consumeStartupPrompt()).count).toBe(1);
    expect(harness.manager.resumeStartupHeld()).toBe(1);
    expect(harness.queue.get(blocked.id)?.status).toBe('pending');
    expect(harness.queue.get(blocked.id)?.input.cookieRetryRequested).toBe(true);
  });

  it('tác vụ cũ chưa có dấu vân tay: so theo mtime của tệp với lúc bị chặn', async () => {
    const setup = withCookieFile(COOKIES_A);
    harness = setup.harness;
    const old = harness.jobIn('paused', { errorCode: 'COOKIES_EXPIRED', errorMessage: 'hết hạn (bản cũ)' });
    const blockedAt = new Date(old.updatedAt).getTime();

    const before = new Date(blockedAt - 60_000);
    utimesSync(setup.file, before, before);
    expect(await harness.manager.resumeCookieBlockedJobs('cookies-saved')).toBe(0);
    expect(harness.queue.get(old.id)?.status).toBe('paused');

    const after = new Date(blockedAt + 60_000);
    utimesSync(setup.file, after, after);
    expect(await harness.manager.resumeCookieBlockedJobs('cookies-saved')).toBe(1);
    expect(harness.queue.get(old.id)?.status).toBe('pending');
  });

  it('chế độ trình duyệt: lý do tạm dừng hướng dẫn đăng nhập lại; khởi động không tự chạy', async () => {
    harness = createQueueHarness({ cookiesBrowser: 'chrome', cookiesBrowserProfile: 'Default' });
    const blocked = await blockWithExpiredCookies(harness);

    expect(blocked.errorMessage).toMatch(/đăng nhập lại/i);
    expect(blocked.errorMessage).toMatch(/Tiếp tục/);

    harness.relaunch();
    await harness.manager.start();
    expect(harness.queue.get(blocked.id)?.status).toBe('paused');
    expect(harness.queue.get(blocked.id)?.errorCode).toBe('COOKIES_EXPIRED');
    expect((await harness.manager.consumeStartupPrompt()).count).toBe(0);

    // Người dùng chủ động lưu lại cấu hình cookies trình duyệt: lúc đó mới chạy lại.
    expect(await harness.manager.resumeCookieBlockedJobs('cookies-saved')).toBe(1);
  });

  it('không ghi nội dung cookies hay giá trị hash vào nhật ký', async () => {
    const setup = withCookieFile(COOKIES_A);
    harness = setup.harness;
    const blocked = await blockWithExpiredCookies(harness);
    const fingerprint = await computeCookieFingerprint(harness.settings);
    expect(fingerprint.mode).toBe('file');
    const hash = fingerprint.mode === 'file' ? fingerprint.sha256 : '';
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    writeFileSync(setup.file, COOKIES_B, 'utf8');
    await harness.manager.resumeCookieBlockedJobs('cookies-saved');

    // Logger thật đi qua redactSecrets trước khi ghi: mô phỏng đúng đường ghi để chắc chắn không lộ.
    const written = JSON.stringify(
      [...harness.logger.info.mock.calls, ...harness.logger.warn.mock.calls, ...harness.logger.error.mock.calls].map(
        (call) => redactSecrets(call)
      )
    );
    expect(written).not.toContain(hash);
    expect(written).not.toContain('gia-tri-a');
    expect(written).not.toContain('gia-tri-b');
    expect(JSON.stringify(redactSecrets({ input: blocked.input }))).not.toContain(hash);
  });
});
