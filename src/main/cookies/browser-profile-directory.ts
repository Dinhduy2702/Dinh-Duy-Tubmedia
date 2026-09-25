import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserProfileOption } from '@shared/types/domain.js';

export type ChromiumBrowserName = 'chrome' | 'edge';

interface ChromiumProfileInfoCacheEntry {
  name?: unknown;
  gaia_name?: unknown;
  gaia_given_name?: unknown;
  user_name?: unknown;
}

interface ChromiumLocalState {
  profile?: {
    info_cache?: Record<string, ChromiumProfileInfoCacheEntry>;
    last_used?: unknown;
  };
}

const BROWSER_USER_DATA_SEGMENTS: Record<ChromiumBrowserName, string[]> = {
  chrome: ['Google', 'Chrome', 'User Data'],
  edge: ['Microsoft', 'Edge', 'User Data']
};

/** "Profile 1" → "Hồ sơ 1"; "Default" → "Mặc định" — dùng khi hồ sơ chưa có tên/email để hiển thị. */
function friendlyFallbackLabel(id: string): string {
  if (id === 'Default') return 'Mặc định';
  const match = /^Profile (\d+)$/.exec(id);
  return match ? `Hồ sơ ${match[1]}` : id;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function labelFor(id: string, entry: ChromiumProfileInfoCacheEntry): string {
  const name = textOf(entry.name) || textOf(entry.gaia_given_name) || friendlyFallbackLabel(id);
  const email = textOf(entry.user_name);
  return email ? `${name} — ${email}` : name;
}

/**
 * Đọc `Local State` của Chrome/Edge để liệt kê THẬT các hồ sơ có trên máy — thay cho việc bắt người
 * dùng tự gõ tên thư mục kỹ thuật. Không throw khi thiếu file/không đọc được/không phải Windows — trả
 * về mảng rỗng để giao diện tự lùi về ô nhập tay (tính năng bổ trợ, không được làm hỏng luồng cũ).
 */
export async function listChromiumProfiles(
  browser: ChromiumBrowserName,
  localAppData: string | undefined = process.env.LOCALAPPDATA
): Promise<BrowserProfileOption[]> {
  if (!localAppData) return [];
  const localStatePath = join(localAppData, ...BROWSER_USER_DATA_SEGMENTS[browser], 'Local State');
  let raw: string;
  try {
    raw = await readFile(localStatePath, 'utf8');
  } catch {
    return [];
  }
  let parsed: ChromiumLocalState;
  try {
    parsed = JSON.parse(raw) as ChromiumLocalState;
  } catch {
    return [];
  }
  const cache = parsed.profile?.info_cache;
  if (!cache || typeof cache !== 'object') return [];
  const lastUsed = textOf(parsed.profile?.last_used);
  const options = Object.entries(cache).map(([id, entry]) => ({
    id,
    label: labelFor(id, entry ?? {}),
    isLastUsed: id === lastUsed
  }));
  // Hồ sơ dùng gần nhất lên đầu — đúng hồ sơ yt-dlp sẽ tự chọn nếu người dùng để trống, nên đưa lên đầu
  // giúp người dùng nhận ra và CHỌN CHỦ ĐỘNG thay vì vô tình để trống rồi bị lấy nhầm.
  options.sort((a, b) => Number(b.isLastUsed) - Number(a.isLastUsed) || a.label.localeCompare(b.label, 'vi'));
  return options;
}
