import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHANGELOG_STUB_MARKER,
  VERSION_FILES,
  collectVersionProblems,
  compareVersions,
  findHardcodedVersionChecks,
  isValidVersion,
  planVersionBump
} from '../../scripts/version-tools.mjs';

function fixture(version = '1.3.7'): Record<string, string> {
  return {
    [VERSION_FILES.packageJson]: `{\n  "name": "demo",\n  "version": "${version}",\n  "description": "x"\n}\n`,
    [VERSION_FILES.packageLock]:
      `{\n  "name": "demo",\n  "version": "${version}",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "demo",\n      "version": "${version}",\n      "dependencies": {}\n    },\n    "node_modules/a": {\n      "version": "9.9.9"\n    }\n  }\n}\n`,
    [VERSION_FILES.appConstants]: `export const APP_NAME = 'x';\nexport const APP_VERSION_LABEL = 'v${version}';\n`,
    [VERSION_FILES.workflow]: `env:\n  GH_TOKEN: abc\n  EXPECTED_VERSION: ${version}\n`,
    [VERSION_FILES.changelog]: `# Tubmedia ${version}\n\n- Ghi chú thật.\n`,
    [VERSION_FILES.sourceManifest]: `{\n  "version": "${version}",\n  "appVersion": "${version}",\n  "requiredFiles": []\n}\n`
  };
}

describe('công cụ tăng và kiểm tra số phiên bản', () => {
  it('chỉ chấp nhận dạng x.y.z hoặc x.y.z-hậu-tố', () => {
    for (const ok of ['1.4.0', '10.20.30', '1.4.0-beta.1', '2.0.0-rc.2']) expect(isValidVersion(ok)).toBe(true);
    for (const bad of ['', '1.4', 'v1.4.0', '1.4.0.1', '1.4.x', '1.4.0-', 'abc', '1.4.0 ', 42, null, undefined]) {
      expect(isValidVersion(bad)).toBe(false);
    }
  });

  it('so sánh phiên bản theo semver, bản thử nghiệm thấp hơn bản chính thức', () => {
    expect(compareVersions('1.4.0', '1.3.7')).toBe(1);
    expect(compareVersions('1.3.7', '1.4.0')).toBe(-1);
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.4.0-beta.1', '1.4.0')).toBe(-1);
    expect(compareVersions('1.4.0-beta.2', '1.4.0-beta.1')).toBe(1);
    expect(compareVersions('1.4.0-beta.10', '1.4.0-beta.9')).toBe(1);
    expect(() => compareVersions('x', '1.0.0')).toThrow();
  });

  it('tăng đồng thời mọi nơi và chèn dòng nhắc vào CHANGELOG khi chưa có mục mới', () => {
    const plan = planVersionBump(fixture(), '1.4.0');
    expect(plan.from).toBe('1.3.7');
    expect(plan.to).toBe('1.4.0');
    expect(Object.keys(plan.files).sort()).toEqual(Object.values(VERSION_FILES).sort());

    const lock = JSON.parse(plan.files[VERSION_FILES.packageLock] ?? '{}') as {
      version: string;
      packages: Record<string, { version: string }>;
    };
    expect(lock.version).toBe('1.4.0');
    expect(lock.packages['']?.version).toBe('1.4.0');
    expect(lock.packages['node_modules/a']?.version).toBe('9.9.9');

    expect(plan.files[VERSION_FILES.appConstants]).toContain("APP_VERSION_LABEL = 'v1.4.0'");
    expect(plan.files[VERSION_FILES.workflow]).toContain('EXPECTED_VERSION: 1.4.0');
    expect(plan.files[VERSION_FILES.changelog]?.startsWith('# Tubmedia 1.4.0\n')).toBe(true);
    expect(plan.files[VERSION_FILES.changelog]).toContain(CHANGELOG_STUB_MARKER);
    expect(plan.files[VERSION_FILES.changelog]).toContain('# Tubmedia 1.3.7');

    const merged = { ...fixture(), ...plan.files };
    expect(collectVersionProblems(merged).filter((p) => !p.includes(CHANGELOG_STUB_MARKER))).toEqual([]);
    expect(collectVersionProblems(merged).some((p) => p.includes(CHANGELOG_STUB_MARKER))).toBe(true);
  });

  it('không chèn dòng nhắc khi CHANGELOG đã có mục của phiên bản mới', () => {
    const files = fixture();
    files[VERSION_FILES.changelog] = `# Tubmedia 1.4.0\n\n- Đã viết.\n\n# Tubmedia 1.3.7\n\n- Cũ.\n`;
    const plan = planVersionBump(files, '1.4.0');
    expect(plan.files[VERSION_FILES.changelog]).toBeUndefined();
    expect(collectVersionProblems({ ...files, ...plan.files })).toEqual([]);
  });

  it('giữ nguyên định dạng dòng CRLF khi chèn mục CHANGELOG', () => {
    const files = fixture();
    files[VERSION_FILES.changelog] = '# Tubmedia 1.3.7\r\n\r\n- Cũ.\r\n';
    const changelog = planVersionBump(files, '1.4.0').files[VERSION_FILES.changelog] ?? '';
    expect(changelog.startsWith('# Tubmedia 1.4.0\r\n\r\n- ')).toBe(true);
    expect(changelog).not.toMatch(/[^\r]\n/);
  });

  it('từ chối phiên bản không hợp lệ, trùng hoặc thấp hơn (không cho hạ cấp)', () => {
    expect(() => planVersionBump(fixture(), '1.4')).toThrow(/không hợp lệ/);
    expect(() => planVersionBump(fixture(), '1.3.7')).toThrow(/lớn hơn/);
    expect(() => planVersionBump(fixture(), '1.3.6')).toThrow(/lớn hơn/);
    expect(() => planVersionBump(fixture('1.4.0'), '1.4.0-beta.1')).toThrow(/lớn hơn/);
  });

  it('báo lỗi rõ khi thiếu tệp hoặc thiếu trường phiên bản', () => {
    const missing = fixture();
    delete missing[VERSION_FILES.workflow];
    expect(() => planVersionBump(missing, '1.4.0')).toThrow(/Thiếu tệp/);

    const noLabel = fixture();
    noLabel[VERSION_FILES.appConstants] = 'export const APP_NAME = "x";\n';
    expect(() => planVersionBump(noLabel, '1.4.0')).toThrow(/Không tìm thấy trường phiên bản/);
  });

  it('phát hiện từng chỗ lệch so với package.json', () => {
    const files = fixture();
    files[VERSION_FILES.appConstants] = "export const APP_VERSION_LABEL = 'v1.3.6';\n";
    files[VERSION_FILES.workflow] = 'EXPECTED_VERSION: 1.3.6\n';
    files[VERSION_FILES.sourceManifest] = '{ "version": "1.3.6", "appVersion": "1.3.6" }';
    files[VERSION_FILES.changelog] = '# Tubmedia 1.3.6\n';
    files[VERSION_FILES.packageLock] = '{ "version": "1.3.6", "packages": { "": { "version": "1.3.5" } } }';
    const problems = collectVersionProblems(files).join('\n');
    expect(problems).toContain('APP_VERSION_LABEL');
    expect(problems).toContain('EXPECTED_VERSION');
    expect(problems).toContain('source-manifest.json version');
    expect(problems).toContain('source-manifest.json appVersion');
    expect(problems).toContain('CHANGELOG.md phải bắt đầu');
    expect(problems).toContain('package-lock.json (gốc)');
    expect(problems).toContain('package-lock.json (packages[""])');
  });

  it('bắt kiểm tra tự động cứng số phiên bản nhưng chấp nhận kiểm tra suy ra từ package.json', () => {
    const bad = [
      "check(pkg.version === '1.3.7', 'x');",
      "const expectedVersion = '1.3.7';",
      "expect(packageJson.version).toBe('1.3.7');",
      "constants.includes(\"APP_VERSION_LABEL = 'v1.3.7'\")",
      "changelog.startsWith('# Tubmedia 1.3.7')"
    ];
    for (const line of bad) expect(findHardcodedVersionChecks('x', line)).toHaveLength(1);

    const good = [
      'check(isValidVersion(pkg.version), "x");',
      'const expectedVersion = packageJson.version;',
      'constants.includes(`APP_VERSION_LABEL = \'v${expectedVersion}\'`)',
      'changelog.startsWith(`# Tubmedia ${expectedVersion}`)'
    ];
    for (const line of good) expect(findHardcodedVersionChecks('x', line)).toEqual([]);
  });

  it('mã nguồn thật của dự án đang đồng nhất số phiên bản', () => {
    const files: Record<string, string> = {};
    for (const path of Object.values(VERSION_FILES)) {
      files[path] = readFileSync(join(process.cwd(), path), 'utf8');
    }
    expect(collectVersionProblems(files)).toEqual([]);
  });
});
