import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieJarStore, sha256 } from '@main/cookies/cookie-jar-store.js';
import { cookiesChangedSinceBlock, computeCookieFingerprint } from '@main/cookies/cookie-fingerprint.js';
import { CookieService } from '@main/cookies/cookie-service.js';
import { defaultAppSettings } from '@main/settings/defaults.js';
import type { AppSettings } from '@shared/types/domain.js';

// 2026-10-27 (rà soát trước 1.7.3, người dùng duyệt): ghi cookie an toàn hơn —
// (1) người dùng lưu cookie mới đúng lúc một video vừa xong: bản người dùng vừa lưu KHÔNG bị bản cũ ghi đè;
// (2) lưu cookie dán vào ghi kiểu nguyên tử (tắt máy giữa chừng không để tệp cookie dở dang);
// (3) tắt đột ngột giữa lúc ghi: tệp tạm chứa cookie còn sót trong thư mục bảo mật được dọn khi mở app;
// (4) tắt đột ngột giữa bước ghi ngược và bước ghi trạng thái: lần mở sau không coi nhầm là "người dùng đổi cookie".

let folder = '';
let security = '';
let settings: AppSettings;
let jar: CookieJarStore;
let service: CookieService;
const skipCheck = (): Promise<never> => Promise.reject(new Error('không gọi mạng trong bài kiểm'));
const cookieFile = (sid: string, ts: string, expires: number): string =>
  `# Netscape HTTP Cookie File\r\n.youtube.com\tTRUE\t/\tTRUE\t2147483647\tSID\t${sid}\r\n.youtube.com\tTRUE\t/\tTRUE\t${expires}\t__Secure-1PSIDTS\t${ts}\r\n`;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-cookie-safety-'));
  security = join(folder, 'security');
  settings = { ...defaultAppSettings, cookiesFilePath: '', cookiesBrowser: 'none', cookiesBrowserProfile: '' };
  const settingsService = { get: () => settings, update: (patch: Partial<AppSettings>) => Object.assign(settings, patch) };
  jar = new CookieJarStore(security);
  service = new CookieService(folder, settingsService as never, jar, () =>
    skipCheck().catch(() => ({ state: 'unknown' as const, reason: null, accountName: null, channelHandle: null, fileExpiresAt: null, checkedAt: '' }))
  );
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe('ghi cookie an toàn', () => {
  it('lưu cookie mới đúng lúc video vừa tải xong (ghi ngược cùng lúc) → luôn giữ bản người dùng vừa lưu', async () => {
    for (let round = 0; round < 25; round += 1) {
      await service.saveText(cookieFile('cu', `ts-cu-${round}`, 1_900_000_000));
      const lease = await jar.lease(settings);
      writeFileSync(lease.settings!.cookiesFilePath, cookieFile('cu', `ts-xoay-${round}`, 1_900_000_500));
      const userNew = cookieFile(`moi-${round}`, `ts-moi-${round}`, 1_900_000_100);
      // Hai việc chạy cùng lúc, thứ tự ngẫu nhiên.
      const tasks = [() => lease.release('success'), () => service.saveText(userNew)];
      if (Math.random() < 0.5) tasks.reverse();
      await Promise.all(tasks.map((task) => task()));
      const final = readFileSync(settings.cookiesFilePath, 'utf8');
      expect(final, `vòng ${round}`).toContain(`SID\tmoi-${round}`);
      expect(final).not.toContain(`ts-xoay-${round}`);
    }
  });

  it('lưu cookie dán vào ghi qua tệp tạm rồi đổi tên (không ghi thẳng đè tệp đang dùng)', () => {
    const source = readFileSync('src/main/cookies/cookie-service.ts', 'utf8');
    expect(source).not.toMatch(/writeFile\(this\.managedPath/);
    expect(source).toContain('saveUserContent(');
  });

  it('mở app: dọn tệp tạm chứa cookie còn sót trong thư mục bảo mật; giữ tệp khác', async () => {
    mkdirSync(security, { recursive: true });
    const leftovers = [
      'cookies-managed.txt.3b1f0c5e-8d2a-4c11-9f7e-1a2b3c4d5e6f.tmp',
      'cookie-jar-state.json.0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.tmp'
    ];
    for (const name of leftovers) writeFileSync(join(security, name), 'SID\tbi-mat');
    writeFileSync(join(security, 'cookies-managed.txt'), 'giu');
    writeFileSync(join(security, 'ghi-chu.tmp'), 'giu');
    await jar.cleanupStaleRuns();
    expect(readdirSync(security).sort()).toEqual(['cookies-managed.txt', 'ghi-chu.tmp']);
  });

  it('tắt đột ngột giữa bước ghi trạng thái và bước ghi cookie → lần mở sau KHÔNG coi là người dùng đổi cookie', async () => {
    await service.saveText(cookieFile('a', 'ts-0', 1_900_000_000));
    const blocked = JSON.parse(JSON.stringify(await computeCookieFingerprint(settings, jar))) as unknown;
    // Một lượt ghi ngược THÀNH CÔNG (YouTube làm mới cookie) sau lúc video bị chặn.
    const lease = await jar.lease(settings);
    writeFileSync(lease.settings!.cookiesFilePath, cookieFile('a', 'ts-1', 1_900_000_100));
    await lease.release('success');
    const fileNow = readFileSync(settings.cookiesFilePath);
    // Lượt ghi ngược kế tiếp: đã ghi trạng thái (hash mới) thì máy tắt, chưa kịp thay tệp cookie.
    const statePath = join(security, 'cookie-jar-state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { files: Record<string, Record<string, unknown>> };
    const key = Object.keys(state.files)[0]!;
    state.files[key] = { ...state.files[key], previousAppWrittenSha256: sha256(fileNow), lastAppWrittenSha256: 'hash-cua-ban-chua-kip-ghi' };
    writeFileSync(statePath, JSON.stringify(state));
    expect(
      cookiesChangedSinceBlock(blocked, await computeCookieFingerprint(settings, jar), null, 'startup'),
      'tệp vẫn là bản app ghi trước đó — không phải người dùng đổi'
    ).toBe(false);
    expect(existsSync(settings.cookiesFilePath)).toBe(true);
  });
});
