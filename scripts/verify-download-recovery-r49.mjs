import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failures = 0;
let checks = 0;

function text(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8').replace(/^\uFEFF/, '');
}
function pass(message) {
  checks += 1;
  console.log('PASS:', message);
}
function fail(message) {
  checks += 1;
  failures += 1;
  console.error('FAIL:', message);
}
function check(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

const errors = text('src/shared/errors/app-errors.ts');
const util = text('src/shared/utils/download-failure.ts');
const engine = text('src/main/downloader/download-engine.ts');
const queue = text('src/main/queue/queue-manager.ts');
const page = text('src/renderer/src/pages/DownloadWorkbenchPage.tsx');
const pkg = JSON.parse(text('package.json'));

check(
  errors.includes('SourceRateLimitedError') &&
    /super\(\s*'SOURCE_RATE_LIMITED'/.test(errors) &&
    errors.includes("super('DOWNLOAD_FAILED', message, retryable, details)"),
  'errors support rate-limit blocking and structured DOWNLOAD_FAILED details'
);
check(
  util.includes('classifyYtDlpFailure') &&
    util.includes('sanitizeYtDlpDiagnostic') &&
    util.includes("'http_429'") &&
    util.includes("'http_403'") &&
    util.includes("'fragment'"),
  'yt-dlp failures have explicit 429/403/fragment/auth/network classification'
);
check(
  util.includes('?[REDACTED]') &&
    util.includes('$1=[REDACTED]') &&
    util.includes('bearer') &&
    util.includes('String.fromCharCode(27)') &&
    util.includes('[A-Za-z0-9._~+/-]'),
  'technical diagnostics redact secrets and strip ANSI without ESLint-blocked regex escapes'
);

const hotfix14Fs = process.getBuiltinModule('node:fs');
const hotfix14Path = process.getBuiltinModule('node:path');

function hotfix14ReadSourceTree(root) {
  let combined = '';
  for (const entry of hotfix14Fs.readdirSync(root, { withFileTypes: true })) {
    const full = hotfix14Path.join(root, entry.name);
    if (entry.isDirectory()) {
      combined += hotfix14ReadSourceTree(full);
      continue;
    }
    if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      combined += '\n' + hotfix14Fs.readFileSync(full, 'utf8');
    }
  }
  return combined;
}

const hotfix14DownloadSource = hotfix14ReadSourceTree(hotfix14Path.join(process.cwd(), 'src'));

check(
  hotfix14DownloadSource.includes('yt-dlp-dynamic-default-no-manual-web-safari') &&
    !/youtube:player[_-]client\s*=\s*[^'"\n]*web_safari/.test(hotfix14DownloadSource) &&
    !/['"]--format-sort['"][\s\S]{0,100}?['"]proto:m3u8['"]/.test(hotfix14DownloadSource) &&
    hotfix14DownloadSource.includes('--continue') &&
    hotfix14DownloadSource.includes('--fragment-retries') &&
    hotfix14DownloadSource.includes('--concurrent-fragments') &&
    hotfix14DownloadSource.includes('--no-cache-dir'),
  'yt-dlp keeps safe partial resume, follows dynamic official clients and refreshes retry metadata'
);
check(
  engine.includes('Math.min(job.attempts > 0 ? 1 : 8') && engine.includes('job.attempts === 0'),
  'retry attempts use one fragment at a time and aria2c remains first-attempt only'
);
check(
  engine.includes('YTDLP_EXIT_RECOVERED_VALID_FILE') &&
    engine.includes('findExistingByLinkTag') &&
    engine.includes('findExistingByMediaId') &&
    engine.indexOf('YTDLP_EXIT_RECOVERED_VALID_FILE') <
      engine.indexOf('const initialCheck = await this.verifier.verify(finalPath'),
  '100%-download false failures recover only a verified final file before full validation'
);
check(
  engine.includes('technicalSummary = sanitizeYtDlpDiagnostic(text)') &&
    engine.includes('failureCategory: failure.category') &&
    engine.includes('failureSubtype: failure.subtype') &&
    engine.includes("clientPolicy: 'yt-dlp-dynamic-default-no-manual-web-safari'") &&
    engine.includes('progressPercent: latestProgress.percent'),
  'genuine download failures retain structured sanitized diagnostics and client policy'
);
check(
  engine.includes('new SourceRateLimitedError(failureDetails)'),
  'HTTP 429 becomes an immediate source-rate-limit blocker instead of blind retries'
);
check(
  queue.includes("code === 'SOURCE_RATE_LIMITED'") &&
    queue.includes("'Nguồn đang giới hạn yêu cầu'") &&
    queue.includes("'Không nhấn thử lại liên tục; hãy chờ để nền tảng gỡ giới hạn.'"),
  'queue pauses a rate-limited list and gives non-spam recovery steps'
);
check(
  queue.includes("progressStage: 'Đang thử lại bằng cookies đã cấu hình'") &&
    queue.includes('resumeStatus: null') &&
    queue.includes("progressStage: 'Cookies mới đã được lưu — đang tự tiếp tục'"),
  'cookie retries clear stale resumeStatus before re-entering the queue'
);
check(
  /cookieRetryRequested:\s*false,\s*resumeStatus:\s*null/.test(queue),
  'successful downloads clear stale cookie/resume markers'
);
check(
  page.includes("'SOURCE_RATE_LIMITED'"),
  'download workbench treats source rate limiting as a blocking issue'
);
check(
  pkg.scripts?.['verify:download-recovery'] === 'node scripts/verify-download-recovery-r49.mjs' &&
    String(pkg.scripts?.check ?? '').includes('verify:download-recovery'),
  'download recovery verifier is permanently included in npm run check'
);
check(
  fs.existsSync(path.join(root, 'tests/unit/download-recovery-r49.test.ts')) &&
    text('tests/unit/download-recovery-r49.test.ts').includes(
      "from '../../src/shared/utils/download-failure.js';"
    ),
  'focused download recovery unit tests are present with a NodeNext-compatible .js import'
);

if (failures) {
  throw new Error(`Download recovery R49 verification failed: ${failures}/${checks} checks failed.`);
}
console.log(`Tubmedia download recovery R49 verification OK: ${checks} checks.`);
