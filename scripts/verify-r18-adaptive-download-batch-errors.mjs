import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

const engine = fs.readFileSync(path.join(cwd, 'src', 'main', 'downloader', 'download-engine.ts'), 'utf8');

const aggregator = fs.readFileSync(
  path.join(cwd, 'src', 'shared', 'batch-error-notification-aggregator.ts'),
  'utf8'
);

const desktopEvents = fs.readFileSync(
  path.join(cwd, 'src', 'renderer', 'src', 'hooks', 'use-desktop-events.ts'),
  'utf8'
);

const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));

let checks = 0;
let failures = 0;

function check(condition, label) {
  checks += 1;

  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL: ${label}`);
  }
}

check(
  engine.includes('youtube-adaptive-r18-default-first-web-safari-fallback'),
  'R18 adaptive YouTube policy marker is present'
);

check(
  /youtube:player[_-]client\s*=\s*default,web_safari/.test(engine),
  'YouTube uses default clients plus web_safari fallback'
);

check(
  !/youtube:player[_-]client\s*=\s*web_safari(?:['"\s,])/.test(engine),
  'web_safari is never the only YouTube player client'
);

check(!/['"]--format-sort['"][\s\S]{0,100}?['"]proto:m3u8['"]/.test(engine), 'global HLS forcing is absent');

check(
  engine.includes('--continue') &&
    engine.includes('--fragment-retries') &&
    engine.includes('--concurrent-fragments'),
  'R49 retry/resume safeguards remain intact'
);

check(
  aggregator.includes('batch-job-failures:${projectId}') &&
    aggregator.includes('bucket.jobIds.has(jobId)') &&
    aggregator.includes('return null'),
  'job failures use one stable project id and duplicate jobs are suppressed'
);

check(
  aggregator.includes("code === 'JOB_FAILED'") &&
    aggregator.includes("code === 'DOWNLOAD_FAILED'") &&
    aggregator.includes("code.endsWith('_FAILED')"),
  'final failure attention codes are explicitly batchable'
);

check(
  aggregator.includes("code === 'DISK_FULL'") &&
    aggregator.includes("code.includes('RATE_LIMIT')") &&
    aggregator.includes("code.includes('COOKIE')"),
  'project/source blocker notifications keep their existing lifecycle'
);

check(
  desktopEvents.includes('TUBMEDIA_R18_R10_CENTRAL_ATTENTION_AGGREGATION') &&
    desktopEvents.includes('coalesceBatchJobFailureAttention(notice)') &&
    desktopEvents.includes('store.setAttention(aggregatedNotice)'),
  'batch aggregation is installed at the single desktop onAttention gateway'
);

check(
  !desktopEvents.includes('store.setAttention(notice);'),
  'raw desktop attention notices are no longer forwarded directly'
);

check(
  desktopEvents.includes('DISK_SPACE_RECOVERED') &&
    desktopEvents.includes("dismissAttentionByCodes(['DISK_FULL'], notice.projectId)"),
  'existing disk recovery notification behavior remains intact'
);

check(
  desktopEvents.includes('store.setAttention({') && desktopEvents.includes('app-update-${key}'),
  'app-update notifications remain outside the batch job-failure aggregator'
);

check(
  fs.existsSync(path.join(cwd, 'tests', 'unit', 'batch-error-aggregation-r18.test.ts')),
  'R18 central batch attention unit tests are present'
);

check(
  pkg.scripts?.['verify:r18-adaptive-batch'] === 'node scripts/verify-r18-adaptive-download-batch-errors.mjs',
  'R18 verifier is registered'
);

check(
  typeof pkg.scripts?.check === 'string' && pkg.scripts.check.includes('npm run verify:r18-adaptive-batch'),
  'R18 verifier is permanent in npm run check'
);

if (failures > 0) {
  throw new Error(`R18 R10 verification failed: ${failures}/${checks} checks failed.`);
}

console.log(`Tubmedia R18 R10 verification OK: ${checks} checks.`);
