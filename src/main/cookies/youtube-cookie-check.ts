import { createHash } from 'node:crypto';
import type { CookieCheckResult } from '@shared/types/domain.js';

/**
 * 2026-10-27 (người dùng yêu cầu): kiểm cookie YouTube NGAY lúc thêm — còn dùng được không, của tài khoản/kênh nào — thay vì
 * tải thử mới biết. Chỉ MỘT yêu cầu nhẹ tới YouTube (menu tài khoản, giống trình duyệt mở menu ảnh đại diện), không tải video.
 * Cookie chỉ gửi tới www.youtube.com, không lưu hay ghi nhật ký nội dung cookie.
 */

interface NetscapeCookie {
  domain: string;
  name: string;
  value: string;
  /** Giây kể từ 1970; 0 = cookie phiên (không ghi hạn). */
  expires: number;
}

/** Cookie đăng nhập Google/YouTube quyết định phiên — dùng để đọc "ngày hết hạn ghi trong tệp". */
const SESSION_COOKIE_NAMES = new Set(['SID', '__Secure-1PSID', '__Secure-3PSID', 'SAPISID', '__Secure-3PAPISID', 'LOGIN_INFO']);
const ACCOUNT_MENU_URL = 'https://www.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false';
const ORIGIN = 'https://www.youtube.com';
const CHECK_TIMEOUT_MS = 12_000;

export function parseNetscapeCookies(text: string): NetscapeCookie[] {
  const cookies: NetscapeCookie[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.startsWith('#HttpOnly_') ? raw.slice('#HttpOnly_'.length) : raw;
    if (!line.trim() || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [domain, , , , expires, name, ...rest] = parts;
    if (!domain || !name) continue;
    cookies.push({ domain, name, value: rest.join('\t'), expires: Number(expires) || 0 });
  }
  return cookies;
}

function forYouTube(cookies: NetscapeCookie[], nowSeconds: number): NetscapeCookie[] {
  // Cookie YouTube + cookie .google.com dùng chung (SID…); bỏ cookie đã hết hạn theo tệp.
  return cookies.filter(
    (cookie) =>
      /(^|\.)youtube\.com$/i.test(cookie.domain.replace(/^\./, '')) &&
      (cookie.expires === 0 || cookie.expires > nowSeconds)
  );
}

/** Hạn ghi trong tệp của cookie đăng nhập (sớm nhất), hoặc null nếu toàn cookie phiên / không có. */
export function fileSessionExpiry(cookies: NetscapeCookie[]): string | null {
  const expiries = cookies
    .filter((cookie) => SESSION_COOKIE_NAMES.has(cookie.name) && cookie.expires > 0)
    .map((cookie) => cookie.expires);
  return expiries.length ? new Date(Math.min(...expiries) * 1000).toISOString() : null;
}

/** Header Authorization kiểu trình duyệt: SAPISIDHASH <giây>_<sha1("giây SAPISID origin")>. */
export function sapisidAuthorization(sapisid: string, nowSeconds: number): string {
  const hash = createHash('sha1').update(`${nowSeconds} ${sapisid} ${ORIGIN}`).digest('hex');
  return `SAPISIDHASH ${nowSeconds}_${hash}`;
}

function text(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.simpleText === 'string') return record.simpleText;
  if (Array.isArray(record.runs)) {
    const joined = record.runs
      .map((run) => {
        const value = run && typeof run === 'object' ? (run as Record<string, unknown>).text : undefined;
        return typeof value === 'string' ? value : '';
      })
      .join('');
    return joined || null;
  }
  return null;
}

/** Đọc tên tài khoản / kênh từ phản hồi menu tài khoản; null nếu YouTube coi là chưa đăng nhập. */
export function accountFromMenuResponse(body: unknown): { accountName: string | null; channelHandle: string | null; loggedOut: boolean } {
  const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const loggedOut =
    ((root.responseContext as Record<string, unknown> | undefined)?.mainAppWebResponseContext as Record<string, unknown> | undefined)
      ?.loggedOut === true;
  let header: Record<string, unknown> | undefined;
  const actions = Array.isArray(root.actions) ? root.actions : [];
  for (const action of actions) {
    const popup = ((action as Record<string, unknown>)?.openPopupAction as Record<string, unknown> | undefined)?.popup as
      | Record<string, unknown>
      | undefined;
    const candidate = ((popup?.multiPageMenuRenderer as Record<string, unknown> | undefined)?.header as Record<string, unknown> | undefined)
      ?.activeAccountHeaderRenderer as Record<string, unknown> | undefined;
    if (candidate) header = candidate;
  }
  return {
    accountName: header ? text(header.accountName) : null,
    channelHandle: header ? text(header.channelHandle) : null,
    loggedOut: loggedOut || !header
  };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

/** Kiểm nội dung tệp cookies (Netscape) với YouTube. Không bao giờ ném lỗi — lỗi mạng trả 'unknown'. */
export async function checkYouTubeCookies(
  netscapeText: string,
  fetchImpl: FetchLike = fetch,
  now = Date.now()
): Promise<CookieCheckResult> {
  const checkedAt = new Date(now).toISOString();
  const nowSeconds = Math.floor(now / 1000);
  const all = parseNetscapeCookies(netscapeText);
  const fileExpiresAt = fileSessionExpiry(all);
  const youtube = forYouTube(all, nowSeconds);
  const base = { accountName: null, channelHandle: null, fileExpiresAt, checkedAt };
  const sapisid =
    youtube.find((cookie) => cookie.name === 'SAPISID')?.value ?? youtube.find((cookie) => cookie.name === '__Secure-3PAPISID')?.value;
  const hasSession = youtube.some((cookie) => cookie.name === 'SID' || cookie.name === '__Secure-1PSID' || cookie.name === '__Secure-3PSID');
  if (!sapisid || !hasSession) {
    return {
      ...base,
      state: 'invalid',
      reason:
        'Tệp không có cookie đăng nhập YouTube (thiếu SID/SAPISID) — có thể đã xuất khi chưa đăng nhập, xuất nhầm trang, hoặc các cookie đăng nhập đã hết hạn.'
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetchImpl(ACCOUNT_MENU_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Cookie: youtube.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
        Authorization: sapisidAuthorization(sapisid, nowSeconds),
        Origin: ORIGIN,
        'X-Origin': ORIGIN,
        'X-Goog-AuthUser': '0'
      },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20241024.00.00', hl: 'vi' } } })
    });
    if (response.status === 401 || response.status === 403) {
      return { ...base, state: 'invalid', reason: `YouTube từ chối cookie này (HTTP ${response.status}) — phiên đăng nhập đã bị thu hồi hoặc đã đăng xuất.` };
    }
    if (response.status === 429) {
      return { ...base, state: 'unknown', reason: 'YouTube đang giới hạn số yêu cầu từ máy bạn (HTTP 429) nên chưa kiểm được; cookie vẫn được lưu.' };
    }
    if (response.status < 200 || response.status >= 300) {
      return { ...base, state: 'unknown', reason: `YouTube trả lỗi HTTP ${response.status} nên chưa kiểm được; cookie vẫn được lưu.` };
    }
    const account = accountFromMenuResponse(await response.json());
    if (account.loggedOut) {
      return {
        ...base,
        state: 'invalid',
        reason: 'YouTube coi cookie này là CHƯA đăng nhập — phiên đã bị thu hồi (đăng xuất, đổi mật khẩu, hoặc YouTube đã xoay cookie).'
      };
    }
    return { ...base, state: 'valid', reason: null, accountName: account.accountName, channelHandle: account.channelHandle };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ...base,
      state: 'unknown',
      reason: aborted
        ? 'YouTube không phản hồi kịp (quá 12 giây) nên chưa kiểm được; cookie vẫn được lưu.'
        : 'Không kết nối được YouTube để kiểm (mạng/proxy) nên chưa kiểm được; cookie vẫn được lưu.'
    };
  } finally {
    clearTimeout(timer);
  }
}
