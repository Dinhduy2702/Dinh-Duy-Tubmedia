import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
};

const diagnosticPolicy = read('src/shared/utils/diagnostic-policy.ts');
const notificationPolicy = read('src/shared/utils/notification-policy.ts');
const diagnosticDock = read('src/renderer/src/components/DiagnosticDock.tsx');
const attentionCenter = read('src/renderer/src/components/AttentionCenter.tsx');
const cookieDialog = read('src/renderer/src/components/CookieManagerDialog.tsx');
const queue = read('src/main/queue/queue-manager.ts');
const ipc = read('src/main/ipc/register-ipc.ts');
const downloadPage = read('src/renderer/src/pages/DownloadWorkbenchPage.tsx');
const mergePage = read('src/renderer/src/pages/DownloadMergePage.tsx');
const notificationCenter = read('src/renderer/src/components/NotificationCenter.tsx');
const store = read('src/renderer/src/stores/app-store.ts');

check(
  // 2026-10-06 (phần B rà soát thông báo): một vấn đề chỉ hiện một nơi — nhật ký gắn danh sách/tác vụ đã có thông báo
  // nổi đại diện nên khung chẩn đoán không hiện chúng nữa (trước đây giữ khi tác vụ còn bị chặn).
  'diagnostic dock leaves job/list issues to the grouped attention notice',
  diagnosticPolicy.includes('if (entry.jobId || entry.projectId) return false;') &&
    diagnosticDock.includes('shouldDisplayDiagnostic(entry, jobs)')
);
check(
  'non-blocking diagnostics expire automatically',
  diagnosticPolicy.includes('TRANSIENT_DIAGNOSTIC_DURATION_MS = 12_000') &&
    diagnosticDock.includes('window.setTimeout(() => setDismissedId(diagnosticId), wait)')
);
check(
  'sticky attention resolves when its job is no longer blocked',
  notificationPolicy.includes('isAttentionNoticeResolved') &&
    attentionCenter.includes('isAttentionNoticeResolved(attention, jobs)') &&
    attentionCenter.includes('if (!attentionResolved')
);
check(
  'persisted queue notices follow the current job lifecycle',
  notificationPolicy.includes('isJobNoticeStillBlocking') &&
    store.includes('reconcileJobNotifications') &&
    store.includes('isJobNoticeStillBlocking(notice, jobs)') &&
    notificationCenter.includes('isJobNoticeStillBlocking(notification, jobs)')
);
check(
  'queue has a cookie-only automatic resume operation',
  // Đợt 1 (d2a06e3): hàm thành bất đồng bộ, nhận nguồn kích hoạt và chỉ chạy lại khi cookies thật sự đổi.
  queue.includes('public async resumeCookieBlockedJobs(trigger: CookieResumeTrigger): Promise<number>') &&
    queue.includes('isCookieBlockingCode(job.errorCode)') &&
    queue.includes("['paused', 'failed', 'interrupted'].includes(job.status)") &&
    queue.includes("status: 'pending'") &&
    queue.includes('COOKIE_BLOCKS_AUTO_RESUMED') &&
    queue.includes('COOKIE_BLOCKS_UNCHANGED')
);
check(
  'all three cookie configuration methods trigger automatic resume',
  ipc.includes('const configureCookies = async') &&
    (ipc.match(/configureCookies\(\(\) => ctx\.cookies\./g) ?? []).length === 3 &&
    ipc.includes("await ctx.queue.resumeCookieBlockedJobs('cookies-saved')")
);
check(
  'cookie dialog confirms automatic continuation with a transient notice',
  cookieDialog.includes('không cần dừng danh sách hoặc bấm tải lại') &&
    cookieDialog.includes('dismissAttentionByCodes(COOKIE_BLOCKING_CODES)') &&
    cookieDialog.includes('await refreshJobs()') &&
    cookieDialog.includes('sticky: false')
);
check(
  'download page only refreshes lane state after cookies',
  /const resumeAfterCookie = async[\s\S]*?window\.desktop\.workbench\.state\(\)[\s\S]*?await refreshJobs\(\);[\s\S]*?\n[ \t]*};/m.test(
    downloadPage
  ) &&
    !/const resumeAfterCookie = async[\s\S]*?queue\.retryFailed/m.test(downloadPage) &&
    !/const resumeAfterCookie = async[\s\S]*?workbench\.resume/m.test(downloadPage)
);
check(
  'merge page only refreshes workflow state after cookies',
  /const resumeAfterCookies = async[\s\S]*?window\.desktop\.workbench\.state\(\)[\s\S]*?await refreshJobs\(\);[\s\S]*?\n[ \t]*};/m.test(
    mergePage
  ) &&
    !/const resumeAfterCookies = async[\s\S]*?queue\.retryFailed/m.test(mergePage) &&
    !/const resumeAfterCookies = async[\s\S]*?workbench\.resume/m.test(mergePage)
);

const failed = checks.filter((entry) => !entry.ok);
if (failed.length > 0) {
  throw new Error(`${failed.length}/${checks.length} notification/cookie upgrade checks failed.`);
}
console.log(`Notification and cookie upgrade verification OK: ${checks.length} checks.`);
