/**
 * Giai đoạn 5 (2026-09-24) — inject-changelog-release-notes.mjs: dùng cho pipeline `release:windows`, nơi
 * electron-builder tự tạo latest.yml/beta.yml (không qua write-updater-metadata-utf8nobom.mjs) — script
 * này đọc lại, chèn thêm releaseNotes lấy thật từ CHANGELOG.md, giữ nguyên mọi trường khác.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Không import 'js-yaml' trực tiếp: package.json chỉ ghim nó qua "overrides" (phiên bản electron-updater
// tự mang theo), không khai báo như dependency riêng của app — đúng quy ước đã dùng ở
// write-updater-metadata-utf8nobom.mjs/verify-updater-metadata-encoding-pre132.mjs.
const updaterRequire = createRequire(join(process.cwd(), 'node_modules/electron-updater/package.json'));
const { load: loadYaml } = updaterRequire('js-yaml') as { load: (text: string) => unknown };

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SCRIPT = join(process.cwd(), 'scripts/inject-changelog-release-notes.mjs');

// Số hiệu GIẢ, cố tình KHÔNG khớp bất kỳ phiên bản thật nào của Tubmedia — chỉ dùng làm tệp CHANGELOG.md
// giả riêng cho bài kiểm này (đọc qua --changelog, không đụng tới CHANGELOG.md thật của dự án). Đặt trong
// biến để verify:version không hiểu nhầm là kiểm tra cứng số phiên bản thật.
const FIXTURE_VERSION = '1.9.9';
const FAKE_CHANGELOG = [
  `# Tubmedia ${FIXTURE_VERSION}`,
  '',
  '- Dòng ghi chú thật số 1.',
  '- Dòng ghi chú thật số 2.',
  ''
].join('\n');

function createFixture(ymlContent: string) {
  const root = mkdtempSync(join(tmpdir(), 'tubmedia-inject-notes-'));
  roots.push(root);
  const ymlPath = join(root, 'latest.yml');
  writeFileSync(ymlPath, ymlContent, 'utf8');
  const changelogPath = join(root, 'CHANGELOG.md');
  writeFileSync(changelogPath, FAKE_CHANGELOG, 'utf8');
  return { root, ymlPath, changelogPath };
}

function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('Giai đoạn 5 — inject-changelog-release-notes.mjs (pipeline release:windows)', () => {
  it('chèn đúng releaseNotes lấy thật từ CHANGELOG.md, giữ nguyên mọi trường electron-builder đã tạo', () => {
    const fixture = createFixture(
      [
        `version: ${FIXTURE_VERSION}`,
        'files:',
        `  - url: Download-video-Tubmedia-Setup-${FIXTURE_VERSION}-x64.exe`,
        '    sha512: real-sha-value',
        '    size: 99999',
        `path: Download-video-Tubmedia-Setup-${FIXTURE_VERSION}-x64.exe`,
        'sha512: real-sha-value',
        "releaseDate: '2026-09-24T00:00:00.000Z'",
        ''
      ].join('\n')
    );

    const result = run([
      '--file',
      fixture.ymlPath,
      '--version',
      FIXTURE_VERSION,
      '--changelog',
      fixture.changelogPath
    ]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('RELEASE_NOTES_INJECTED_OK');

    const updated = loadYaml(readFileSync(fixture.ymlPath, 'utf8')) as Record<string, unknown>;
    expect(updated.version).toBe(FIXTURE_VERSION);
    expect(updated.sha512).toBe('real-sha-value');
    expect((updated.files as Array<{ size: number }>)[0]?.size).toBe(99999);
    expect(updated.releaseNotes).toBe('- Dòng ghi chú thật số 1.\n- Dòng ghi chú thật số 2.');
  });

  it('phiên bản không có trong CHANGELOG.md: thất bại rõ ràng, KHÔNG ghi đè tệp gốc', () => {
    const original = [`version: ${FIXTURE_VERSION}`, "releaseDate: '2026-09-24T00:00:00.000Z'", ''].join('\n');
    const fixture = createFixture(original);

    const result = run(['--file', fixture.ymlPath, '--version', '9.0.0', '--changelog', fixture.changelogPath]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('thiếu mục');
    expect(readFileSync(fixture.ymlPath, 'utf8')).toBe(original);
  });

  it('tệp .yml không hợp lệ: báo lỗi rõ ràng thay vì ghi dữ liệu hỏng', () => {
    const fixture = createFixture('- không phải một object YAML hợp lệ cho updater');
    const result = run([
      '--file',
      fixture.ymlPath,
      '--version',
      FIXTURE_VERSION,
      '--changelog',
      fixture.changelogPath
    ]);
    expect(result.status).not.toBe(0);
  });

  it('thiếu --file hoặc --version: báo lỗi rõ ràng ngay từ đầu', () => {
    const missingFile = run(['--version', FIXTURE_VERSION]);
    expect(missingFile.status).not.toBe(0);
    expect(missingFile.stderr).toContain('--file');

    const missingVersion = run(['--file', 'x.yml']);
    expect(missingVersion.status).not.toBe(0);
    expect(missingVersion.stderr).toContain('--version');
  });
});
