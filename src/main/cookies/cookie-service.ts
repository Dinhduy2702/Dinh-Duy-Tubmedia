import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { AppSettings, CookieConfigurationStatus } from '@shared/types/domain.js';
import { InvalidCookieTextError } from '@shared/errors/app-errors.js';
import type { SettingsService } from '../settings/settings-service.js';

function normalizedCookieLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function isNetscapeDataLine(line: string): boolean {
  const trimmed = line.trimStart();
  return !trimmed.startsWith('#') || trimmed.startsWith('#HttpOnly_');
}

function normalizeNetscape(text: string): string | null {
  const lines = normalizedCookieLines(text);
  const data = lines.filter(isNetscapeDataLine);
  if (!data.length) return null;
  const normalized: string[] = [];
  for (const line of data) {
    if (line.split('\t').length >= 7) {
      normalized.push(line);
      continue;
    }
    const match = /^(\S+)\s+(TRUE|FALSE)\s+(\S+)\s+(TRUE|FALSE)\s+(\d+)\s+(\S+)\s+(.+)$/i.exec(line);
    if (!match) return null;
    normalized.push(match.slice(1).join('\t'));
  }
  return ['# Netscape HTTP Cookie File', ...normalized].join('\r\n') + '\r\n';
}

function normalizeJsonCookies(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray(Reflect.get(parsed, 'cookies'))
      ? Reflect.get(parsed, 'cookies') as unknown[]
      : null;
  if (!values?.length) return null;
  const lines: string[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const cookie = value as Record<string, unknown>;
    const name = cookie.name;
    const cookieValue = cookie.value;
    const domainValue = cookie.domain;
    if (typeof name !== 'string' || typeof cookieValue !== 'string' || typeof domainValue !== 'string') continue;
    const domain = domainValue.trim();
    if (!domain || /[\t\r\n]/.test(`${domain}${name}${cookieValue}`)) continue;
    const pathValue = cookie.path;
    const secureValue = cookie.secure;
    const expirationValue = cookie.expirationDate ?? cookie.expires;
    const expiration = Number(expirationValue);
    lines.push([
      domain,
      domain.startsWith('.') ? 'TRUE' : 'FALSE',
      typeof pathValue === 'string' && pathValue.startsWith('/') ? pathValue : '/',
      secureValue === true ? 'TRUE' : 'FALSE',
      Number.isFinite(expiration) && expiration > 0 ? String(Math.floor(expiration)) : '0',
      name,
      cookieValue
    ].join('\t'));
  }
  return lines.length
    ? ['# Netscape HTTP Cookie File', ...lines].join('\r\n') + '\r\n'
    : null;
}

function normalizeCookieHeader(text: string): string | null {
  const header = text.trim().replace(/^cookie\s*:\s*/i, '');
  if (!header.includes('=')) return null;
  const pairs = header.split(';').map((part) => part.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    if (separator <= 0) return null;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name || /[\t\r\n]/.test(`${name}${value}`)) return null;
    lines.push(['.youtube.com', 'TRUE', '/', 'TRUE', '0', name, value].join('\t'));
  }
  return lines.length
    ? ['# Netscape HTTP Cookie File', ...lines].join('\r\n') + '\r\n'
    : null;
}

export function normalizeCookieText(text: string): string {
  if (!text.trim()) {
    throw new InvalidCookieTextError('Nội dung cookies đang trống. Hãy dán cookies dạng Netscape, JSON hoặc chuỗi Cookie.');
  }
  const normalized = normalizeNetscape(text)
    ?? normalizeJsonCookies(text)
    ?? normalizeCookieHeader(text);
  if (!normalized) {
    throw new InvalidCookieTextError(
      'Không nhận diện được nội dung cookies. Ứng dụng hỗ trợ Netscape cookies.txt, JSON xuất từ trình duyệt hoặc chuỗi Cookie dạng name=value; name2=value2.'
    );
  }
  return normalized;
}

export class CookieService {
  private readonly managedPath: string;

  public constructor(
    userData: string,
    private readonly settings: SettingsService
  ) {
    this.managedPath = join(userData, 'security', 'cookies-managed.txt');
  }

  public status(): CookieConfigurationStatus {
    const current = this.settings.get();
    const managed = current.cookiesFilePath.length > 0 && resolve(current.cookiesFilePath) === resolve(this.managedPath);
    if (current.cookiesBrowser !== 'none') {
      const profile = current.cookiesBrowserProfile ? ` · ${current.cookiesBrowserProfile}` : '';
      return {
        mode: 'browser',
        label: `${current.cookiesBrowser.toUpperCase()}${profile}`,
        browser: current.cookiesBrowser,
        browserProfile: current.cookiesBrowserProfile,
        filePath: '',
        managed: false
      };
    }
    if (current.cookiesFilePath) {
      return {
        mode: managed ? 'pasted' : 'file',
        label: managed ? 'Cookies đã dán trực tiếp và lưu bảo mật' : `Tệp ${basename(current.cookiesFilePath)}`,
        browser: 'none',
        browserProfile: '',
        filePath: current.cookiesFilePath,
        managed
      };
    }
    return {
      mode: 'none',
      label: 'Chưa cấu hình cookies',
      browser: 'none',
      browserProfile: '',
      filePath: '',
      managed: false
    };
  }

  public async saveText(text: string): Promise<CookieConfigurationStatus> {
    const normalized = normalizeCookieText(text);
    await mkdir(dirname(this.managedPath), { recursive: true });
    await writeFile(this.managedPath, normalized, { encoding: 'utf8', mode: 0o600 });
    this.settings.update({
      cookiesFilePath: this.managedPath,
      cookiesBrowser: 'none',
      cookiesBrowserProfile: ''
    });
    return this.status();
  }

  public async useFile(path: string): Promise<CookieConfigurationStatus> {
    const text = await readFile(path, 'utf8');
    const normalized = normalizeCookieText(text);
    await mkdir(dirname(this.managedPath), { recursive: true });
    await writeFile(this.managedPath, normalized, { encoding: 'utf8', mode: 0o600 });
    this.settings.update({
      cookiesFilePath: this.managedPath,
      cookiesBrowser: 'none',
      cookiesBrowserProfile: ''
    });
    return this.status();
  }

  public useBrowser(
    browser: Exclude<AppSettings['cookiesBrowser'], 'none'>,
    profile: string
  ): CookieConfigurationStatus {
    this.settings.update({
      cookiesFilePath: '',
      cookiesBrowser: browser,
      cookiesBrowserProfile: profile.trim()
    });
    return this.status();
  }

  public async clear(): Promise<CookieConfigurationStatus> {
    await rm(this.managedPath, { force: true });
    this.settings.update({
      cookiesFilePath: '',
      cookiesBrowser: 'none',
      cookiesBrowserProfile: ''
    });
    return this.status();
  }
}
