import fs from 'node:fs';

let failures = 0;
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (condition) {
    console.log('PASS:', message);
  } else {
    failures += 1;
    console.error('FAIL:', message);
  }
}

function text(rel) {
  return fs.readFileSync(rel, 'utf8');
}

const helper = text('src/shared/utils/youtube-url-validation.ts');
const queue = text('src/main/queue/queue-manager.ts');
const quick = text('src/main/download/quick-download-service.ts');
const engine = text('src/main/downloader/download-engine.ts');
const attention = text('src/renderer/src/hooks/use-desktop-events.ts');
const pkg = JSON.parse(text('package.json'));
const test = text('tests/unit/youtube-url-validation-r34.test.ts');

check(helper.includes('TUBMEDIA_R34_YOUTUBE_VIDEO_ID_VALIDATION'), 'shared R34 validation marker exists');
check(helper.includes('/^[A-Za-z0-9_-]{11}$/'), 'YouTube video ids require exactly eleven safe characters');
check(helper.includes("host === 'youtu.be'"), 'short youtu.be links are validated');
check(helper.includes("parsed.pathname === '/watch'"), 'watch?v links are validated');
check(helper.includes('shorts|live|embed|v'), 'shorts/live/embed video paths are validated');
check(
  queue.includes('TUBMEDIA_R34_QUEUE_YOUTUBE_VALIDATION'),
  'queue blocks malformed YouTube ids before DownloadEngine'
);
check(
  queue.includes('throw new InvalidInputError(malformedYouTubeMessage)'),
  'normal queue uses a non-retryable invalid-input error'
);
check(
  quick.includes('TUBMEDIA_R34_QUICK_YOUTUBE_VALIDATION'),
  'Quick Download validates before yt-dlp preparation'
);
check(
  test.includes('dhMfDxCfCo') && test.includes('toHaveLength(10)'),
  'regression test covers the exact production URL'
);
check(test.includes('dash and underscore'), 'regression tests preserve dash/underscore ids');
check(
  engine.includes('youtube-adaptive-r18-default-first-web-safari-fallback') &&
    engine.includes('verify-existing-final-before-retry'),
  'R18 and R49 downloader contracts remain untouched'
);
check(
  attention.includes('TUBMEDIA_R31N_NOTIFICATION_SPAM_COOKIE_ACTION'),
  'R31N notification/cookie patch remains intact'
);
check(
  pkg.scripts?.['verify:youtube-url-validation-r34'] === 'node scripts/verify-youtube-url-validation-r34.mjs',
  'R34 verifier is registered'
);
check(
  String(pkg.scripts?.check ?? '').includes('verify:youtube-url-validation-r34'),
  'R34 verifier is permanent in npm run check'
);
check(
  String(pkg.scripts?.check ?? '').includes('verify:download-recovery') &&
    String(pkg.scripts?.check ?? '').includes('verify:r18-adaptive-batch') &&
    String(pkg.scripts?.check ?? '').includes('verify:notification-cookie-action'),
  'R49, R18 and R31N permanent gates remain present'
);

if (failures) {
  throw new Error('R34 YouTube URL validation failed: ' + failures + '/' + checks);
}

console.log('Tubmedia R34 YouTube URL validation OK: ' + checks + ' checks.');
