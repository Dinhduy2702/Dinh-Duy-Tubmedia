import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix, win32, join } from 'node:path';
import { InvalidInputError } from '@shared/errors/app-errors.js';
import { appSettingsSchema } from '@shared/schemas/ipc.js';
import type { AppSettings } from '@shared/types/domain.js';

/**
 * Hai nhóm cài đặt mà renderer bị chiếm quyền có thể lợi dụng để chạy mã tùy ý:
 *  - appFeedUrl: nơi ứng dụng tải bản cập nhật rồi cài im lặng;
 *  - đường dẫn yt-dlp/ffmpeg/ffprobe/aria2c: tệp mà ứng dụng sẽ spawn.
 * Các hàm dưới đây là thuần (không phụ thuộc Electron) để dùng chung cho IPC, lúc đọc từ
 * database và lúc khôi phục backup.
 */
export const TOOL_PATH_SETTINGS = {
  ytdlpPath: 'yt-dlp',
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  aria2cPath: 'aria2c'
} as const;

export type ToolPathSettingKey = keyof typeof TOOL_PATH_SETTINGS;
export type GuardedSettingKey = ToolPathSettingKey | 'appFeedUrl';

const GUARDED_KEYS: readonly GuardedSettingKey[] = [
  'appFeedUrl',
  'ytdlpPath',
  'ffmpegPath',
  'ffprobePath',
  'aria2cPath'
];

const FALLBACK_FEED_HOSTS = ['github.com'];
const UPDATE_CONFIG_FILE = 'app-update.yml';

function pathApi(platform: NodeJS.Platform): typeof win32 {
  return platform === 'win32' ? win32 : posix;
}

export function expectedToolFileName(key: ToolPathSettingKey, platform: NodeJS.Platform = process.platform): string {
  return `${TOOL_PATH_SETTINGS[key]}${platform === 'win32' ? '.exe' : ''}`;
}

/** Cùng cách chuẩn hóa với ToolManager: bỏ khoảng trắng và cặp dấu nháy bao quanh. */
export function stripToolPathQuotes(value: string): string {
  return value.trim().replace(/^"(.*)"$/, '$1').trim();
}

export function isUncPath(value: string): boolean {
  return value.startsWith('\\\\') || value.startsWith('//');
}

/** Kiểm tra cú pháp; trả về lý do từ chối hoặc null nếu hợp lệ. Chuỗi rỗng nghĩa là "tự động". */
export function toolPathSyntaxError(
  key: ToolPathSettingKey,
  rawValue: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const value = stripToolPathQuotes(rawValue);
  if (!value) return null;
  const api = pathApi(platform);
  if (value.includes('\0')) return 'Đường dẫn chứa ký tự không hợp lệ.';
  if (isUncPath(value)) return 'Không chấp nhận đường dẫn mạng UNC (\\\\máy\\thư-mục).';
  if (!api.isAbsolute(value)) return 'Đường dẫn công cụ phải là đường dẫn đầy đủ (ví dụ C:\\Tools\\yt-dlp.exe).';
  const expected = expectedToolFileName(key, platform);
  const actual = api.basename(value);
  const same = platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  if (!same) return `Tên tệp phải là ${expected}.`;
  return null;
}

/** Tệp phải tồn tại và là tệp thường (không phải thư mục). */
export function toolPathDiskError(rawValue: string): string | null {
  const value = stripToolPathQuotes(rawValue);
  if (!value) return null;
  try {
    return statSync(value).isFile() ? null : 'Đường dẫn công cụ không phải là một tệp.';
  } catch {
    return 'Không tìm thấy tệp công cụ tại đường dẫn này.';
  }
}

/** Lấy host mặc định từ nội dung app-update.yml (github → github.com, generic → host của url). */
export function feedHostsFromUpdateConfig(text: string): string[] {
  const read = (key: string): string | null => {
    const match = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'mi').exec(text);
    return match?.[1]?.replace(/^["']|["']$/g, '') ?? null;
  };
  const provider = read('provider')?.toLowerCase();
  if (provider === 'github') return [(read('host') ?? 'github.com').toLowerCase()];
  const url = read('url');
  if (url) {
    try {
      return [new URL(url).host.toLowerCase()];
    } catch {
      return [];
    }
  }
  return [];
}

const hostCache = new Map<string, string[]>();

/** Host của địa chỉ cập nhật mặc định đi kèm bản cài (app-update.yml); không có thì dùng github.com. */
export function defaultFeedHosts(resourcesPath: string | undefined = process.resourcesPath): string[] {
  const key = resourcesPath ?? '';
  const cached = hostCache.get(key);
  if (cached) return cached;
  let hosts: string[] = [];
  if (resourcesPath) {
    const file = join(resourcesPath, UPDATE_CONFIG_FILE);
    try {
      if (existsSync(file)) hosts = feedHostsFromUpdateConfig(readFileSync(file, 'utf8'));
    } catch {
      hosts = [];
    }
  }
  const resolved = hosts.length > 0 ? hosts : FALLBACK_FEED_HOSTS;
  hostCache.set(key, resolved);
  return resolved;
}

/** Chỉ HTTPS, không kèm tài khoản, và cùng host với địa chỉ cập nhật mặc định. */
export function feedUrlError(rawValue: string, allowedHosts: readonly string[] = defaultFeedHosts()): string | null {
  const value = rawValue.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'Địa chỉ nhận cập nhật không hợp lệ.';
  }
  if (parsed.protocol !== 'https:') return 'Địa chỉ nhận cập nhật bắt buộc dùng HTTPS.';
  if (parsed.username || parsed.password) return 'Địa chỉ nhận cập nhật không được chứa tài khoản/mật khẩu.';
  const allowed = allowedHosts.map((host) => host.toLowerCase());
  if (!allowed.includes(parsed.host.toLowerCase())) {
    return `Địa chỉ nhận cập nhật chỉ được dùng máy chủ mặc định của ứng dụng (${allowed.join(', ')}).`;
  }
  return null;
}

/** Cú pháp của một trường được bảo vệ; null nếu hợp lệ. */
export function guardedSettingError(
  key: GuardedSettingKey,
  value: unknown,
  allowedHosts: readonly string[] = defaultFeedHosts()
): string | null {
  if (typeof value !== 'string') return 'Giá trị phải là chuỗi.';
  return key === 'appFeedUrl' ? feedUrlError(value, allowedHosts) : toolPathSyntaxError(key, value);
}

export interface DroppedSetting {
  key: GuardedSettingKey;
  reason: string;
}

/**
 * Dùng khi đọc từ database: trường bảo vệ không hợp lệ bị bỏ qua (về chuỗi rỗng = tự động)
 * thay vì được tin cậy. Không kiểm tra sự tồn tại của tệp ở đây để không xóa nhầm cài đặt
 * của người dùng khi ổ đĩa ngoài tạm thời chưa cắm.
 */
export function sanitizeGuardedSettings(
  settings: AppSettings,
  allowedHosts: readonly string[] = defaultFeedHosts()
): { settings: AppSettings; dropped: DroppedSetting[] } {
  const dropped: DroppedSetting[] = [];
  let next = settings;
  for (const key of GUARDED_KEYS) {
    const reason = guardedSettingError(key, settings[key], allowedHosts);
    if (reason === null) continue;
    dropped.push({ key, reason });
    if (next === settings) next = { ...settings };
    next[key] = '';
  }
  return { settings: next, dropped };
}

const LABELS: Record<GuardedSettingKey, string> = {
  appFeedUrl: 'Địa chỉ nhận cập nhật',
  ytdlpPath: 'Đường dẫn yt-dlp',
  ffmpegPath: 'Đường dẫn FFmpeg',
  ffprobePath: 'Đường dẫn ffprobe',
  aria2cPath: 'Đường dẫn aria2c'
};

/**
 * Dùng khi người dùng lưu cài đặt: chỉ kiểm tra nghiêm các trường bảo vệ thực sự thay đổi, để
 * một giá trị cũ không còn hợp lệ không làm hỏng việc lưu các cài đặt khác.
 */
export function assertGuardedSettingsChange(
  current: AppSettings,
  patch: Partial<AppSettings>,
  allowedHosts: readonly string[] = defaultFeedHosts()
): void {
  for (const key of GUARDED_KEYS) {
    const value = patch[key];
    if (value === undefined || value === current[key]) continue;
    const reason = guardedSettingError(key, value, allowedHosts);
    if (reason) throw new InvalidInputError(`${LABELS[key]}: ${reason}`);
    if (key !== 'appFeedUrl') {
      const diskReason = toolPathDiskError(value);
      if (diskReason) throw new InvalidInputError(`${LABELS[key]}: ${diskReason}`);
    }
  }
}

/**
 * Dùng khi khôi phục backup (tệp không đáng tin): từng trường trong app_settings phải qua schema
 * của ứng dụng và chính sách bảo vệ; trường sai bị bỏ để rơi về giá trị mặc định.
 */
export function sanitizeRestoredAppSettings(
  raw: unknown,
  allowedHosts: readonly string[] = defaultFeedHosts(),
  checkToolFilesOnDisk = true
): { value: Record<string, unknown>; dropped: string[] } {
  const dropped: string[] = [];
  const value: Record<string, unknown> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { value, dropped: ['(toàn bộ)'] };
  }
  const shape = appSettingsSchema.shape as Record<string, { safeParse: (input: unknown) => { success: boolean } }>;
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const schema = shape[key];
    if (!schema || !schema.safeParse(entry).success) {
      dropped.push(key);
      continue;
    }
    if (key in TOOL_PATH_SETTINGS || key === 'appFeedUrl') {
      const invalid =
        guardedSettingError(key as GuardedSettingKey, entry, allowedHosts) !== null ||
        (checkToolFilesOnDisk && key !== 'appFeedUrl' && toolPathDiskError(String(entry)) !== null);
      if (invalid) {
        dropped.push(key);
        continue;
      }
    }
    value[key] = entry;
  }
  return { value, dropped };
}
