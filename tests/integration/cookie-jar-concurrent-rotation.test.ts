import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieJarStore } from '@main/cookies/cookie-jar-store.js';

// 2026-10-27 (người dùng yêu cầu): mô phỏng NHIỀU video tải song song dùng chung MỘT cookie, YouTube tự làm mới cookie
// (Set-Cookie) ở nhiều thời điểm gần nhau trong lúc tải — xem tệp cookie gốc có giữ đúng bản mới nhất không.
// Mỗi "lượt yt-dlp" mượn một bản sao (lease), ghi cookie mới vào bản sao như yt-dlp thật, rồi trả lại (release).
// Google đặt hạn cookie = lúc cấp + cố định, nên bản cấp SAU luôn có hạn (cột 5) LỚN hơn — dùng để biết bản nào mới hơn.

let folder = '';
let original = '';
let jar: CookieJarStore;
const BASE = 1_900_000_000;

const line = (name: string, value: string, expires: number, domain = '.youtube.com'): string =>
  [domain, 'TRUE', '/', 'TRUE', String(expires), name, value].join('\t');
const fileOf = (lines: string[]): string => ['# Netscape HTTP Cookie File', ...lines].join('\n') + '\n';
const cookiesIn = (text: string): Map<string, { value: string; expires: number }> => {
  const map = new Map<string, { value: string; expires: number }>();
  for (const raw of text.split(/\r?\n/)) {
    const lineText = raw.startsWith('#HttpOnly_') ? raw.slice(10) : raw;
    if (!lineText || lineText.startsWith('#')) continue;
    const parts = lineText.split('\t');
    if (parts.length < 7) continue;
    map.set(parts[5]!, { value: parts[6]!, expires: Number(parts[4]) });
  }
  return map;
};

/** Một lượt yt-dlp: mượn bản sao, (sau một lúc) nhận Set-Cookie mới → ghi vào bản sao, rồi trả lại khi tải xong. */
async function ytdlpRun(updates: Record<string, { value: string; expires: number } | null>): Promise<() => Promise<void>> {
  const lease = await jar.lease({ cookiesFilePath: original, cookiesBrowser: 'none', cookiesBrowserProfile: '' });
  const copy = lease.settings!.cookiesFilePath;
  return async () => {
    const current = cookiesIn(await readFile(copy, 'utf8'));
    for (const [name, next] of Object.entries(updates)) {
      if (next === null) current.delete(name);
      else current.set(name, next);
    }
    await writeFile(copy, fileOf([...current].map(([name, cookie]) => line(name, cookie.value, cookie.expires))));
    await lease.release('success');
  };
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-cookie-rotation-'));
  original = join(folder, 'cookies.txt');
  writeFileSync(
    original,
    fileOf([line('SID', 'sid', BASE + 999_999), line('__Secure-1PSIDTS', 'ts-0', BASE), line('YSC', 'ysc-0', 0), line('VISITOR_INFO1_LIVE', 'v-0', BASE)])
  );
  jar = new CookieJarStore(join(folder, 'security'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe('nhiều video tải song song dùng chung một cookie', () => {
  it('lượt xong SAU mang cookie mới hơn → tệp giữ bản mới nhất, không bỏ mất', async () => {
    const a = await ytdlpRun({ '__Secure-1PSIDTS': { value: 'ts-A', expires: BASE + 100 } });
    const b = await ytdlpRun({ '__Secure-1PSIDTS': { value: 'ts-B', expires: BASE + 200 } });
    await a();
    await b();
    expect(cookiesIn(readFileSync(original, 'utf8')).get('__Secure-1PSIDTS')?.value).toBe('ts-B');
  });

  it('lượt xong SAU mang cookie CŨ hơn → không ghi đè bản mới bằng bản cũ', async () => {
    const older = await ytdlpRun({ '__Secure-1PSIDTS': { value: 'ts-old', expires: BASE + 100 } });
    const newer = await ytdlpRun({ '__Secure-1PSIDTS': { value: 'ts-new', expires: BASE + 300 } });
    await newer();
    await older();
    expect(cookiesIn(readFileSync(original, 'utf8')).get('__Secure-1PSIDTS')?.value).toBe('ts-new');
  });

  it('mỗi lượt làm mới một cookie KHÁC nhau → giữ đủ mọi thay đổi, không lượt nào bị bỏ', async () => {
    const a = await ytdlpRun({ '__Secure-1PSIDTS': { value: 'ts-A', expires: BASE + 100 } });
    const b = await ytdlpRun({ YSC: { value: 'ysc-B', expires: 0 } });
    const c = await ytdlpRun({ VISITOR_INFO1_LIVE: { value: 'v-C', expires: BASE + 50 } });
    await Promise.all([a(), b(), c()]);
    const final = cookiesIn(readFileSync(original, 'utf8'));
    expect([final.get('__Secure-1PSIDTS')?.value, final.get('YSC')?.value, final.get('VISITOR_INFO1_LIVE')?.value]).toEqual(['ts-A', 'ysc-B', 'v-C']);
    expect(final.get('SID')?.value, 'cookie không ai đụng giữ nguyên').toBe('sid');
  });

  it('20 lượt song song, YouTube cấp cookie mới liên tục, trả lại theo thứ tự ngẫu nhiên → luôn giữ bản cấp sau cùng', async () => {
    for (let round = 0; round < 5; round += 1) {
      writeFileSync(original, fileOf([line('SID', 'sid', BASE + 999_999), line('__Secure-1PSIDTS', 'ts-0', BASE)]));
      const releases = [];
      for (let i = 1; i <= 20; i += 1) releases.push(await ytdlpRun({ '__Secure-1PSIDTS': { value: `ts-${i}`, expires: BASE + i } }));
      const shuffled = releases.map((release) => ({ release, key: Math.random() })).sort((x, y) => x.key - y.key);
      await Promise.all(shuffled.map(({ release }, index) => new Promise<void>((resolveRun) => setTimeout(() => void release().then(resolveRun), index % 4))));
      expect(cookiesIn(readFileSync(original, 'utf8')).get('__Secure-1PSIDTS')?.value, `vòng ${round}`).toBe('ts-20');
    }
  });

  it('YouTube xoá một cookie trong lượt → xoá ở tệp gốc (trừ khi lượt khác vừa làm mới nó)', async () => {
    const remover = await ytdlpRun({ VISITOR_INFO1_LIVE: null });
    await remover();
    expect(cookiesIn(readFileSync(original, 'utf8')).has('VISITOR_INFO1_LIVE')).toBe(false);
  });

  it('người dùng lưu cookie MỚI (tài khoản khác) trong lúc đang tải → không trộn cookie của phiên cũ vào', async () => {
    const run = await ytdlpRun({ '__Secure-1PSIDTS': { value: 'ts-phien-cu', expires: BASE + 500 } });
    writeFileSync(original, fileOf([line('SID', 'sid-moi', BASE + 999_999), line('__Secure-1PSIDTS', 'ts-moi', BASE + 1)]));
    await jar.recordUserSave(original);
    await run();
    const final = cookiesIn(readFileSync(original, 'utf8'));
    expect([final.get('SID')?.value, final.get('__Secure-1PSIDTS')?.value]).toEqual(['sid-moi', 'ts-moi']);
  });
});
