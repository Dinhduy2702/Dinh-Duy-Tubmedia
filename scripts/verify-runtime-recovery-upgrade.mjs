import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
};

const queue = read('src/main/queue/queue-manager.ts');
const queueRepository = read('src/main/database/repositories/queue-repository.ts');
const cookiePolicy = read('src/shared/utils/cookie-policy.ts');
const cookieDialog = read('src/renderer/src/components/CookieManagerDialog.tsx');
const store = read('src/renderer/src/stores/app-store.ts');
const diagnosticPolicy = read('src/shared/utils/diagnostic-policy.ts');
const diagnosticDock = read('src/renderer/src/components/DiagnosticDock.tsx');
const downloadEngine = read('src/main/downloader/download-engine.ts');
const downloadQuality = read('src/shared/utils/download-quality.ts');
const ipc = read('src/main/ipc/register-ipc.ts');
const cookieResumeMethod =
  queue.split('public resumeCookieBlockedJobs(): number')[1]?.split('public retry(jobId: string)')[0] ?? '';

check(
  'cookie configuration triggers queue auto-resume',
  ipc.includes('ctx.queue.resumeCookieBlockedJobs()') &&
    (ipc.match(/configureCookies\(\(\) => ctx\.cookies\./g) ?? []).length === 3
);
check(
  'cookie-blocked jobs resume without manual list restart',
  cookieResumeMethod.length > 0 &&
    /cookieRetryRequested:\s*true/.test(cookieResumeMethod) &&
    /errorCode:\s*null/.test(cookieResumeMethod) &&
    /this\.emitProgress\(resumedJob\)/.test(cookieResumeMethod) &&
    !cookieResumeMethod.includes('this.active.has(job.id)')
);
check(
  'cookie retry marker survives cleared visible error',
  cookiePolicy.includes('job.input?.cookieRetryRequested === true') &&
    queue.includes('cookieRetryRequested: false')
);
check(
  'cookie UI clears stale notices and refreshes jobs',
  cookieDialog.includes('dismissAttentionByCodes(COOKIE_BLOCKING_CODES)') &&
    cookieDialog.includes('await refreshJobs()') &&
    store.includes('dismissAttentionByCodes')
);
check(
  'diagnostic dock only remains while a job is really blocked',
  diagnosticDock.includes('shouldDisplayDiagnostic(entry, jobs)') &&
    diagnosticPolicy.includes('isDiagnosticStillBlocking') &&
    diagnosticPolicy.includes('COOKIE_BLOCKS_AUTO_RESUMED') &&
    diagnosticPolicy.includes('DOWNLOAD_SIZE_ESTIMATE_MISMATCH')
);
check(
  'legacy size-estimate failures recover automatically on startup',
  queue.includes('recoverLegacySizeEstimateFailures()') &&
    /recoverLegacySizeEstimateFailures\(\)\s*:\s*number/.test(queueRepository) &&
    queueRepository.includes('Tệp tải về có dung lượng thấp bất thường')
);
check(
  'selected-size metadata is advisory after verification',
  downloadQuality.includes('suspicious: boolean') &&
    downloadEngine.includes('DOWNLOAD_SIZE_ESTIMATE_MISMATCH') &&
    downloadEngine.includes('Tệp đã vượt qua kiểm tra thời lượng và giải mã') &&
    !downloadEngine.includes('Tệp tải về có dung lượng thấp bất thường và đã chuyển vào khu cách ly')
);
check(
  'download verification compares expected duration',
  downloadEngine.includes('selectedDurationSeconds ?? undefined') &&
    downloadEngine.includes('this.verifier.verify(path, level, expectedDuration')
);

const failed = checks.filter((entry) => !entry.ok);
if (failed.length > 0) {
  throw new Error(`${failed.length}/${checks.length} runtime recovery upgrade checks failed.`);
}
console.log(`Runtime recovery upgrade verification OK: ${checks.length} checks.`);
