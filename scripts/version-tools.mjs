// Công cụ thuần (không đọc/ghi đĩa) cho việc tăng và kiểm tra số phiên bản.
// package.json là nguồn duy nhất; mọi nơi khác chỉ được PHẢN CHIẾU giá trị đó.

export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
export const CHANGELOG_STUB_MARKER = 'CHƯA ĐIỀN GHI CHÚ PHÁT HÀNH';

export const VERSION_FILES = Object.freeze({
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  appConstants: 'src/shared/constants/app.ts',
  workflow: '.github/workflows/publish-tubmedia-release.yml',
  changelog: 'CHANGELOG.md',
  sourceManifest: 'source-manifest.json'
});

export function isValidVersion(value) {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

function splitVersion(value) {
  const [core, ...rest] = value.split('-');
  return { core: core.split('.').map(Number), prerelease: rest.join('-') };
}

function comparePrerelease(left, right) {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

/** -1 | 0 | 1 theo quy tắc semver; ném lỗi nếu chuỗi không hợp lệ. */
export function compareVersions(left, right) {
  if (!isValidVersion(left) || !isValidVersion(right)) {
    throw new Error(`Số phiên bản không hợp lệ: "${left}" hoặc "${right}".`);
  }
  const a = splitVersion(left);
  const b = splitVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} không phải JSON hợp lệ: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Thay giá trị của khóa "version"/"appVersion" đầu tiên khớp; trả null nếu không thấy. */
function replaceFirstJsonString(text, key, value) {
  const pattern = new RegExp(`("${key}"\\s*:\\s*")[^"]*(")`);
  if (!pattern.test(text)) return null;
  return text.replace(pattern, (_match, head, tail) => `${head}${value}${tail}`);
}

/** Thay khóa "version" thứ hai (bản ghi gốc `packages[""]` trong package-lock.json). */
function replaceSecondVersion(text, value) {
  const pattern = /("version"\s*:\s*")[^"]*(")/g;
  let seen = 0;
  let replaced = false;
  const next = text.replace(pattern, (match, head, tail) => {
    seen += 1;
    if (seen === 2) {
      replaced = true;
      return `${head}${value}${tail}`;
    }
    return match;
  });
  return replaced ? next : null;
}

/**
 * Kế hoạch tăng phiên bản. `files` là { đường dẫn tương đối: nội dung }.
 * Trả về nội dung mới của từng tệp CÓ thay đổi; không ghi gì ra đĩa.
 */
export function planVersionBump(files, newVersion) {
  if (!isValidVersion(newVersion)) {
    throw new Error(`Số phiên bản mới không hợp lệ: "${newVersion}". Dạng đúng: 1.4.0 hoặc 1.4.0-beta.1.`);
  }
  for (const path of Object.values(VERSION_FILES)) {
    if (typeof files[path] !== 'string') throw new Error(`Thiếu tệp cần cập nhật: ${path}`);
  }
  const current = parseJson(files[VERSION_FILES.packageJson], VERSION_FILES.packageJson).version;
  if (!isValidVersion(current)) throw new Error(`package.json đang có phiên bản không hợp lệ: "${current}".`);
  if (compareVersions(newVersion, current) <= 0) {
    throw new Error(
      `Phiên bản mới ${newVersion} phải lớn hơn phiên bản hiện tại ${current}. Tubmedia không cho phép hạ hoặc lặp phiên bản.`
    );
  }

  const out = {};
  const set = (path, text) => {
    if (text === null) throw new Error(`Không tìm thấy trường phiên bản trong ${path}.`);
    if (text !== files[path]) out[path] = text;
  };

  set(VERSION_FILES.packageJson, replaceFirstJsonString(files[VERSION_FILES.packageJson], 'version', newVersion));

  const lockText = files[VERSION_FILES.packageLock];
  const lockStep = replaceFirstJsonString(lockText, 'version', newVersion);
  set(VERSION_FILES.packageLock, lockStep === null ? null : replaceSecondVersion(lockStep, newVersion));

  const constants = files[VERSION_FILES.appConstants];
  const labelPattern = /(APP_VERSION_LABEL\s*=\s*')v[^']*(')/;
  set(
    VERSION_FILES.appConstants,
    labelPattern.test(constants)
      ? constants.replace(labelPattern, (_m, head, tail) => `${head}v${newVersion}${tail}`)
      : null
  );

  const workflow = files[VERSION_FILES.workflow];
  const workflowPattern = /(EXPECTED_VERSION:\s*)\S+/;
  set(
    VERSION_FILES.workflow,
    workflowPattern.test(workflow) ? workflow.replace(workflowPattern, (_m, head) => `${head}${newVersion}`) : null
  );

  const manifestStep = replaceFirstJsonString(files[VERSION_FILES.sourceManifest], 'version', newVersion);
  set(
    VERSION_FILES.sourceManifest,
    manifestStep === null ? null : replaceFirstJsonString(manifestStep, 'appVersion', newVersion)
  );

  const changelog = files[VERSION_FILES.changelog];
  const heading = `# Tubmedia ${newVersion}`;
  if (!changelog.startsWith(`${heading}\n`) && !changelog.startsWith(`${heading}\r\n`)) {
    const eol = changelog.includes('\r\n') ? '\r\n' : '\n';
    set(
      VERSION_FILES.changelog,
      `${heading}${eol}${eol}- ${CHANGELOG_STUB_MARKER}${eol}${eol}${changelog}`
    );
  }

  return { from: current, to: newVersion, files: out };
}

/**
 * Trả về danh sách vấn đề (rỗng nếu mọi nơi khớp package.json).
 * `files` cùng dạng như planVersionBump.
 */
export function collectVersionProblems(files) {
  const problems = [];
  const need = (path) => {
    if (typeof files[path] !== 'string') {
      problems.push(`Thiếu tệp ${path}.`);
      return false;
    }
    return true;
  };
  if (!Object.values(VERSION_FILES).every(need)) return problems;

  const version = parseJson(files[VERSION_FILES.packageJson], VERSION_FILES.packageJson).version;
  if (!isValidVersion(version)) {
    problems.push(`package.json có phiên bản không hợp lệ: "${String(version)}".`);
    return problems;
  }

  const lock = parseJson(files[VERSION_FILES.packageLock], VERSION_FILES.packageLock);
  if (lock.version !== version) problems.push(`package-lock.json (gốc) là ${lock.version}, cần ${version}.`);
  if (lock.packages?.['']?.version !== version) {
    problems.push(`package-lock.json (packages[""]) là ${lock.packages?.['']?.version}, cần ${version}.`);
  }

  const label = /APP_VERSION_LABEL\s*=\s*'([^']*)'/.exec(files[VERSION_FILES.appConstants])?.[1];
  if (label !== `v${version}`) problems.push(`APP_VERSION_LABEL là "${label}", cần "v${version}".`);

  const expected = /EXPECTED_VERSION:\s*(\S+)/.exec(files[VERSION_FILES.workflow])?.[1];
  if (expected !== version) problems.push(`Workflow phát hành có EXPECTED_VERSION=${expected}, cần ${version}.`);

  const manifest = parseJson(files[VERSION_FILES.sourceManifest], VERSION_FILES.sourceManifest);
  if (manifest.version !== version) problems.push(`source-manifest.json version là ${manifest.version}, cần ${version}.`);
  if (manifest.appVersion !== version) {
    problems.push(`source-manifest.json appVersion là ${manifest.appVersion}, cần ${version}.`);
  }

  const changelog = files[VERSION_FILES.changelog];
  if (!/^# Tubmedia (\S+)/.test(changelog) || /^# Tubmedia (\S+)/.exec(changelog)?.[1] !== version) {
    problems.push(`CHANGELOG.md phải bắt đầu bằng "# Tubmedia ${version}".`);
  }
  const firstSection = changelog.split(/^# Tubmedia /m)[1] ?? '';
  if (firstSection.includes(CHANGELOG_STUB_MARKER)) {
    problems.push(`CHANGELOG.md của ${version} vẫn còn dòng "${CHANGELOG_STUB_MARKER}". Hãy viết ghi chú thật.`);
  }
  return problems;
}

const HARDCODED_VERSION_CHECKS = [
  /\b(?:pkg|packageJson|packageLock|package\w*)[\w.?[\]'"]*\.version\s*[!=]==\s*['"]\d+\.\d+\.\d+/,
  /\bexpectedVersion\s*=\s*['"]\d+\.\d+\.\d+/,
  /\.version\s*\)\s*\.toBe\(\s*['"]\d+\.\d+\.\d+/,
  /APP_VERSION_LABEL\s*=\s*'v\d+\.\d+/,
  /startsWith\(\s*['"]# Tubmedia \d+\.\d+/,
  /includes\(\s*['"]APP_VERSION_LABEL\s*=\s*'v\d/
];

/** Các kiểm tra tự động không được cứng phiên bản; trả về danh sách dòng vi phạm. */
export function findHardcodedVersionChecks(fileName, text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (HARDCODED_VERSION_CHECKS.some((pattern) => pattern.test(line))) {
      problems.push(`${fileName}:${index + 1}: cứng số phiên bản: ${line.trim().slice(0, 120)}`);
    }
  });
  return problems;
}
