import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const queuePath = path.join(cwd, 'src', 'main', 'queue', 'queue-manager.ts');

const source = fs.readFileSync(queuePath, 'utf8');

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

const start = source.indexOf('public async pauseProject(projectId: string): Promise<void>');

const end = source.indexOf('public async resumeProject(projectId: string): Promise<void>', start);

const block = start >= 0 && end > start ? source.slice(start, end) : '';

check(
  block.includes('TUBMEDIA_V132_PAUSE_PROJECT_RACE_SAFE'),
  'pauseProject uses the v1.3.2 race-safe implementation'
);

check(
  block.includes('const current = this.repo.get(snapshot.id)') &&
    block.includes('PAUSABLE_STATUSES.has(current.status)'),
  'pauseProject re-reads each live job instead of trusting a stale project snapshot'
);

check(
  block.includes('error instanceof InvalidInputError') &&
    block.includes('const latest = this.repo.get(current.id)') &&
    block.includes('!PAUSABLE_STATUSES.has(latest.status)'),
  'pauseProject treats a job finishing during pause as a safe no-op'
);

check(
  block.includes("this.repo.get(current.id)?.status === 'paused'"),
  'pauseProject counts only jobs that actually reached paused'
);

check(
  block.includes('this.syncProjectStatus(projectId)') && block.includes('PROJECT_PAUSE_NOOP'),
  'pause on an already-completed project preserves its completed project status'
);

check(
  !block.includes("['pending',") && !block.includes('].includes(job.status)'),
  'pauseProject no longer duplicates a stale local status list'
);

if (failures > 0) {
  throw new Error(`v1.3.2 pause-project race verification failed: ${failures}/${checks}`);
}

console.log(`Tubmedia v1.3.2 pause-project race verification OK: ${checks} checks.`);
