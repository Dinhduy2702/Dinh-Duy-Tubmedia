import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCommitLabel, resolveBuildCommit } from '../../src/shared/utils/build-commit.js';

// Đợt 5 (rà soát bản cài 2026-10-02 mục 17): bản cài cùng số hiệu 1.5.0 nhưng thiếu một commit — không có cách nào biết
// bản đang chạy build từ mã nào ngoài giải nén asar. Chẩn đoán và Giới thiệu phải hiện mã commit của bản build.

describe('resolveBuildCommit — mã commit lúc build', () => {
  it('lấy 7 ký tự đầu của HEAD khi có git', () => {
    expect(resolveBuildCommit({ git: () => 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n', env: {} })).toBe('a1b2c3d');
  });

  it('không có git → dùng GITHUB_SHA (CI)', () => {
    expect(
      resolveBuildCommit({
        git: () => {
          throw new Error('git not found');
        },
        env: { GITHUB_SHA: 'ffeeddccbbaa99887766554433221100ffeeddcc' }
      })
    ).toBe('ffeeddc');
  });

  it('không có git lẫn GITHUB_SHA, hoặc giá trị lạ → rỗng (không bịa)', () => {
    const noGit = (): string => {
      throw new Error('no');
    };
    expect(resolveBuildCommit({ git: noGit, env: {} })).toBe('');
    expect(resolveBuildCommit({ git: () => 'fatal: not a git repository', env: {} })).toBe('');
  });
});

describe('buildCommitLabel', () => {
  it('ghi rõ khi không xác định được', () => {
    expect(buildCommitLabel('a1b2c3d')).toBe('a1b2c3d');
    expect(buildCommitLabel('')).toBe('Không xác định');
  });
});

describe('nối vào bản build và giao diện', () => {
  const read = (path: string): string => readFileSync(path, 'utf8');

  it('electron-vite nhúng mã commit vào cả tiến trình chính lẫn giao diện', () => {
    const config = read('electron.vite.config.ts');
    expect(config).toContain('resolveBuildCommit(');
    expect(config.match(/__TUBMEDIA_BUILD_COMMIT__/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('Giới thiệu và Chẩn đoán hiện mã commit; gói chẩn đoán xuất ra có mã commit', () => {
    expect(read('src/renderer/src/pages/AboutPage.tsx')).toContain('APP_BUILD_COMMIT');
    expect(read('src/renderer/src/pages/DiagnosticsPage.tsx')).toContain('APP_BUILD_COMMIT');
    expect(read('src/main/ipc/register-ipc.ts')).toContain('buildCommit: APP_BUILD_COMMIT');
  });
});
