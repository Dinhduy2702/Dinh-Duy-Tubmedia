import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  accountFromMenuResponse,
  checkYouTubeCookies,
  fileSessionExpiry,
  parseNetscapeCookies,
  sapisidAuthorization,
  type FetchLike
} from '../../src/main/cookies/youtube-cookie-check.js';
import { readDevelopmentEnvironment } from '../../src/main/runtime/development-environment.js';

// 2026-10-27 (người dùng yêu cầu): kiểm cookie YouTube ngay lúc thêm — còn dùng được không, của tài khoản nào. Bài kiểm KHÔNG
// gọi YouTube thật: mọi phản hồi là giả.
const NOW = Date.UTC(2026, 9, 27, 3, 0, 0);
const FAR = Math.floor(Date.UTC(2027, 9, 27) / 1000);
const PAST = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const cookieFile = (lines: string[]): string => ['# Netscape HTTP Cookie File', ...lines].join('\n');
const LOGGED_IN = cookieFile([
  `.youtube.com\tTRUE\t/\tTRUE\t${FAR}\tSID\tsid-value`,
  `.youtube.com\tTRUE\t/\tTRUE\t${FAR}\tSAPISID\tsapisid-value`,
  `#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t${FAR - 86400}\t__Secure-3PSID\tpsid3`,
  `.youtube.com\tTRUE\t/\tTRUE\t0\tYSC\tysc`,
  `.google.com\tTRUE\t/\tTRUE\t${FAR}\tNID\tkhong-gui-cho-youtube`
]);
const menu = (accountName: string, handle: string): unknown => ({
  responseContext: { mainAppWebResponseContext: { loggedOut: false } },
  actions: [
    {
      openPopupAction: {
        popup: {
          multiPageMenuRenderer: {
            header: { activeAccountHeaderRenderer: { accountName: { simpleText: accountName }, channelHandle: { simpleText: handle } } }
          }
        }
      }
    }
  ]
});
const fakeFetch = (status: number, body: unknown = {}): { fetch: FetchLike; calls: Array<Parameters<FetchLike>> } => {
  const calls: Array<Parameters<FetchLike>> = [];
  return {
    calls,
    fetch: vi.fn((...args: Parameters<FetchLike>) => {
      calls.push(args);
      return Promise.resolve({ status, json: () => Promise.resolve(body) });
    })
  };
};

describe('đọc tệp cookies', () => {
  it('đọc cả dòng #HttpOnly_, lấy hạn sớm nhất của cookie đăng nhập ghi trong tệp', () => {
    const cookies = parseNetscapeCookies(LOGGED_IN);
    expect(cookies.map((cookie) => cookie.name)).toEqual(['SID', 'SAPISID', '__Secure-3PSID', 'YSC', 'NID']);
    expect(fileSessionExpiry(cookies)).toBe(new Date((FAR - 86400) * 1000).toISOString());
  });

  it('chữ ký SAPISIDHASH đúng kiểu trình duyệt', () => {
    const expected = createHash('sha1').update('1761534000 abc https://www.youtube.com').digest('hex');
    expect(sapisidAuthorization('abc', 1761534000)).toBe(`SAPISIDHASH 1761534000_${expected}`);
  });
});

describe('kiểm với YouTube', () => {
  it('đã đăng nhập → "hoạt động" + tên tài khoản và kênh; chỉ gửi cookie YouTube', async () => {
    const { fetch, calls } = fakeFetch(200, menu('Đình Duy', '@dinhduy'));
    const result = await checkYouTubeCookies(LOGGED_IN, fetch, NOW);
    expect(result).toMatchObject({ state: 'valid', accountName: 'Đình Duy', channelHandle: '@dinhduy', reason: null });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toContain('https://www.youtube.com/youtubei/v1/account/account_menu');
    expect(init.headers.Cookie).toContain('SID=sid-value');
    expect(init.headers.Cookie).not.toContain('NID=');
    expect(init.headers.Authorization).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
  });

  it('YouTube coi là chưa đăng nhập → "không hoạt động" kèm lý do', async () => {
    const { fetch } = fakeFetch(200, { responseContext: { mainAppWebResponseContext: { loggedOut: true } } });
    const result = await checkYouTubeCookies(LOGGED_IN, fetch, NOW);
    expect(result.state).toBe('invalid');
    expect(result.reason).toContain('CHƯA đăng nhập');
  });

  it('HTTP 401/403 → "không hoạt động"; 429, lỗi khác, mạng hỏng → "chưa kiểm được" (không kết luận cookie hỏng)', async () => {
    expect((await checkYouTubeCookies(LOGGED_IN, fakeFetch(401).fetch, NOW)).state).toBe('invalid');
    expect((await checkYouTubeCookies(LOGGED_IN, fakeFetch(429).fetch, NOW)).state).toBe('unknown');
    expect((await checkYouTubeCookies(LOGGED_IN, fakeFetch(500).fetch, NOW)).state).toBe('unknown');
    const broken: FetchLike = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));
    expect((await checkYouTubeCookies(LOGGED_IN, broken, NOW)).state).toBe('unknown');
  });

  it('tệp không có cookie đăng nhập (hoặc đã hết hạn theo tệp) → "không hoạt động", không gọi YouTube', async () => {
    const { fetch, calls } = fakeFetch(200, menu('x', '@x'));
    const expired = cookieFile([`.youtube.com\tTRUE\t/\tTRUE\t${PAST}\tSID\ta`, `.youtube.com\tTRUE\t/\tTRUE\t${PAST}\tSAPISID\tb`]);
    expect((await checkYouTubeCookies(expired, fetch, NOW)).state).toBe('invalid');
    expect((await checkYouTubeCookies(cookieFile([`.youtube.com\tTRUE\t/\tTRUE\t0\tYSC\tysc`]), fetch, NOW)).reason).toContain('thiếu SID/SAPISID');
    expect(calls).toHaveLength(0);
  });

  it('đọc tên tài khoản cả dạng runs', () => {
    expect(
      accountFromMenuResponse({
        actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: { accountName: { runs: [{ text: 'A' }, { text: 'B' }] } } } } } } }]
      })
    ).toEqual({ accountName: 'AB', channelHandle: null, loggedOut: false });
  });
});

describe('kết quả giả cho bài e2e', () => {
  it('chỉ khi chạy từ mã nguồn + e2e; bản đã cài bỏ qua', () => {
    const env = { TUBMEDIA_E2E: '1', TUBMEDIA_E2E_FAKE_COOKIE_CHECK: JSON.stringify({ state: 'valid', accountName: 'X' }) };
    expect(readDevelopmentEnvironment(env, false).e2eFakeCookieCheck).toMatchObject({ state: 'valid', accountName: 'X' });
    expect(readDevelopmentEnvironment(env, true).e2eFakeCookieCheck).toBeUndefined();
    expect(readDevelopmentEnvironment({ ...env, TUBMEDIA_E2E: '' }, false).e2eFakeCookieCheck).toBeUndefined();
  });
});
