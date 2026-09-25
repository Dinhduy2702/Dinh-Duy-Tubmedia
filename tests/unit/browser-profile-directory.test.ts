import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listChromiumProfiles } from '../../src/main/cookies/browser-profile-directory.js';

// Sự cố 2026-09-25: máy có nhiều hồ sơ Chrome thì để trống ô hồ sơ khiến yt-dlp tự chọn hồ sơ "dùng
// gần nhất trong Chrome" (đọc field "last_used" trong Local State) — không phải hồ sơ người dùng nghĩ
// tới. Cấu trúc JSON bên dưới sao chép ĐÚNG các field thật đã xác nhận trên máy có 6 hồ sơ thật (chỉ
// đổi tên/email sang dữ liệu giả để bài kiểm không phụ thuộc máy chạy).
function fakeLocalState(): string {
  return JSON.stringify({
    profile: {
      last_used: 'Profile 1',
      info_cache: {
        Default: {
          name: 'Duy',
          gaia_name: 'Duy Đình',
          gaia_given_name: 'Duy',
          user_name: 'ca-nhan@gmail.com'
        },
        'Profile 1': {
          name: 'Media',
          gaia_name: 'Media Tub',
          gaia_given_name: 'Media',
          user_name: 'tubmediatool@gmail.com'
        },
        'Profile 2': {
          name: 'Capcut Pro',
          gaia_name: 'Monkey.D Vien',
          gaia_given_name: 'Monkey.D',
          user_name: 'capcut@gmail.com'
        }
      }
    }
  });
}

describe('listChromiumProfiles', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tubmedia-chromium-profiles-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('liệt kê đúng hồ sơ thật, ghép tên hồ sơ với email tài khoản', async () => {
    const userData = join(root, 'Google', 'Chrome', 'User Data');
    await mkdir(userData, { recursive: true });
    await writeFile(join(userData, 'Local State'), fakeLocalState(), 'utf8');

    const profiles = await listChromiumProfiles('chrome', root);

    expect(profiles).toHaveLength(3);
    const byId = new Map(profiles.map((item) => [item.id, item]));
    expect(byId.get('Default')?.label).toBe('Duy — ca-nhan@gmail.com');
    expect(byId.get('Profile 1')?.label).toBe('Media — tubmediatool@gmail.com');
    expect(byId.get('Profile 2')?.label).toBe('Capcut Pro — capcut@gmail.com');
  });

  it('đưa đúng hồ sơ "dùng gần nhất" (last_used) lên đầu danh sách', async () => {
    const userData = join(root, 'Google', 'Chrome', 'User Data');
    await mkdir(userData, { recursive: true });
    await writeFile(join(userData, 'Local State'), fakeLocalState(), 'utf8');

    const profiles = await listChromiumProfiles('chrome', root);

    expect(profiles[0]?.id).toBe('Profile 1');
    expect(profiles[0]?.isLastUsed).toBe(true);
    expect(profiles.filter((item) => item.isLastUsed)).toHaveLength(1);
  });

  it('đọc đúng thư mục User Data riêng của Edge, không lẫn với Chrome', async () => {
    const userData = join(root, 'Microsoft', 'Edge', 'User Data');
    await mkdir(userData, { recursive: true });
    await writeFile(
      join(userData, 'Local State'),
      JSON.stringify({ profile: { last_used: 'Default', info_cache: { Default: { name: 'Edge User' } } } }),
      'utf8'
    );

    const chromeProfiles = await listChromiumProfiles('chrome', root);
    const edgeProfiles = await listChromiumProfiles('edge', root);

    expect(chromeProfiles).toEqual([]);
    expect(edgeProfiles).toHaveLength(1);
    expect(edgeProfiles[0]?.label).toBe('Edge User');
  });

  it('trả về hồ sơ không có tài khoản Google với tên đọc được, không hiện chuỗi rỗng', async () => {
    const userData = join(root, 'Google', 'Chrome', 'User Data');
    await mkdir(userData, { recursive: true });
    await writeFile(
      join(userData, 'Local State'),
      JSON.stringify({ profile: { last_used: '', info_cache: { Default: {}, 'Profile 3': {} } } }),
      'utf8'
    );

    const profiles = await listChromiumProfiles('chrome', root);

    expect(profiles.find((item) => item.id === 'Default')?.label).toBe('Mặc định');
    expect(profiles.find((item) => item.id === 'Profile 3')?.label).toBe('Hồ sơ 3');
  });

  it('trả về mảng rỗng khi không đọc được (không cài trình duyệt, thiếu quyền, JSON hỏng) thay vì báo lỗi', async () => {
    await expect(listChromiumProfiles('chrome', root)).resolves.toEqual([]);

    const userData = join(root, 'Google', 'Chrome', 'User Data');
    await mkdir(userData, { recursive: true });
    await writeFile(join(userData, 'Local State'), '{ không phải JSON hợp lệ', 'utf8');
    await expect(listChromiumProfiles('chrome', root)).resolves.toEqual([]);
  });

  it('trả về mảng rỗng khi không xác định được LOCALAPPDATA', async () => {
    // Truyền chuỗi rỗng (không phải `undefined`) để không vô tình rơi vào giá trị mặc định của tham số
    // (process.env.LOCALAPPDATA thật của máy đang chạy bài kiểm) — phải kiểm đúng nhánh "không có gì".
    await expect(listChromiumProfiles('chrome', '')).resolves.toEqual([]);
  });
});
