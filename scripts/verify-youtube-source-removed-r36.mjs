import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const text = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const check = (condition, message) => {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
  console.log('PASS:', message);
};

const util = text('src/shared/utils/download-failure.ts');
const errors = text('src/shared/errors/app-errors.ts');
const engine = text('src/main/downloader/download-engine.ts');
const queue = text('src/main/queue/queue-manager.ts');
const batch = text('src/shared/batch-error-notification-aggregator.ts');
const quick = text('src/main/download/quick-download-service.ts');
const quickType = text('src/shared/quick-download.ts');
const quickPanel = text('src/renderer/src/components/QuickDownloadPanel.tsx');
const queuePage = text('src/renderer/src/pages/QueuePage.tsx');
const r49Unit = text('tests/unit/download-recovery-r49.test.ts');
const durationUnit = text('tests/unit/video-duration-persistence.test.ts');
const pkg = JSON.parse(text('package.json'));

check(pkg.version === '1.3.6', 'public version is 1.3.6');
check(util.includes("| 'removed'"), 'download failure subtype includes removed');
check(util.includes('isExplicitlyRemovedYoutubeSource'), 'explicit removed-source detector exists');

const detectorStart = util.indexOf('export function isExplicitlyRemovedYoutubeSource');
const classifierStart = util.indexOf('export function classifyYtDlpFailure');

check(detectorStart >= 0, 'removed-source detector body is readable');
check(classifierStart > detectorStart, 'classifyYtDlpFailure follows detector');

const detectorSection = util.slice(detectorStart, classifierStart);
const detectorCallToken = 'isExplicitlyRemovedYoutubeSource(';
const detectorOccurrences = detectorSection.split(detectorCallToken).length - 1;

check(detectorOccurrences === 1, 'removed-source detector has no recursive self-call');

const classifierNextExport = util.indexOf(String.fromCharCode(10) + 'export function ', classifierStart + 1);
const classifierEnd = classifierNextExport >= 0 ? classifierNextExport : util.length;
const classifierSection = util.slice(classifierStart, classifierEnd);

check(
  classifierSection.includes('isExplicitlyRemovedYoutubeSource(lower)') &&
    classifierSection.includes("subtype: 'removed'"),
  'removed-source branch lives inside classifyYtDlpFailure'
);

check(util.includes('removed by the uploader'), 'uploader removal signature is covered');
check(
  util.includes('account associated with this video has been terminated'),
  'terminated-account removal is covered'
);
check(
  errors.includes('SourceRemovedError') && errors.includes("'SOURCE_REMOVED'"),
  'stable SOURCE_REMOVED AppError exists'
);
check(
  engine.includes("failure.subtype === 'removed'") && engine.includes('new SourceRemovedError'),
  'download engine maps removed source before generic failure handling'
);
check(queue.includes("code === 'SOURCE_REMOVED'"), 'queue owns removed-source terminal behavior');
check(
  queue.includes("status: 'skipped'") && queue.includes('JOB_SKIPPED_SOURCE_REMOVED'),
  'removed source is skipped instead of failed'
);
check(queue.includes('JOB_SKIPPED_SOURCE_REMOVED_DEPENDENCY'), 'dependent processing is safely skipped');
check(batch.includes("code === 'SOURCE_REMOVED'"), 'removed source is excluded from error batching');
check(
  quickType.includes("'skipped'") || quickType.includes('"skipped"'),
  'Quick Download contract supports skipped terminal phase'
);
check(
  quick.includes('QUICK_DOWNLOAD_SOURCE_REMOVED') && quick.includes("phase = 'skipped'"),
  'Quick Download reports removed source as skipped'
);
check(quickPanel.includes("skipped: 'Bỏ qua'"), 'QuickDownloadPanel has a Vietnamese skipped phase label');
check(queuePage.includes("skipped: 'Bỏ qua'"), 'QueuePage has a Vietnamese skipped phase label');

for (const [name, source] of [
  ['QuickDownloadPanel', quickPanel],
  ['QueuePage', queuePage]
]) {
  const interruptedAt = source.indexOf('interrupted:');
  const skippedAt = source.indexOf("skipped: 'Bỏ qua'");

  check(interruptedAt >= 0 && skippedAt > interruptedAt, name + ' keeps skipped after interrupted');

  const between = source.slice(interruptedAt, skippedAt);
  check(between.includes(','), name + ' has a comma before skipped');
}

check(
  r49Unit.includes("classifyYtDlpFailure('ERROR: Video unavailable. This video has been removed')") &&
    r49Unit.includes("subtype: 'removed'"),
  'legacy R49 unit test expects explicit removed source subtype'
);
check(durationUnit.includes("toBe('1.3.6')"), 'duration persistence unit test expects public version 1.3.6');
check(
  fs.existsSync(path.join(root, 'tests/unit/youtube-source-removed-r36.test.ts')),
  'focused removed-source tests exist'
);
const verifierSource = text('scripts/verify-youtube-source-removed-r36.mjs');

check(
  verifierSource.includes('String.fromCharCode(10)'),
  'R36.11 verifier uses escape-safe newline construction'
);

const escapedNewlineToken =
  'util.indexOf(' +
  String.fromCharCode(39) +
  String.fromCharCode(92) +
  'nexport function ' +
  String.fromCharCode(39);

check(
  !verifierSource.includes(escapedNewlineToken),
  'R36.11 verifier does not use nested escaped-newline literals'
);
check(pkg.scripts['verify:youtube-source-removed-r36'], 'R36 verifier is registered');
check(
  String(pkg.scripts.check).includes('verify:youtube-source-removed-r36'),
  'R36 verifier is permanent in npm run check'
);
for (const gate of [
  'verify:download-recovery',
  'verify:youtube-url-validation-r34',
  'verify:r18-adaptive-batch',
  'verify:notification-cookie-action',
  'verify:quick-download'
]) {
  check(String(pkg.scripts.check).includes(gate), gate + ' remains in npm run check');
}

console.log('Tubmedia v1.3.6 R36 YouTube removed-source verification OK.');
