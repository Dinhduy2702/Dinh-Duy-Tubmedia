import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}

const panel = read('src/renderer/src/components/QuickDownloadPanel.tsx');
const shared = read('src/shared/quick-download.ts');
const service = read('src/main/download/quick-download-service.ts');
const command = read('src/main/download/quick-download-command.ts');
const context = read('src/main/app/app-context.ts');
const ipc = read('src/main/ipc/register-ipc.ts');
const preload = read('src/preload/index.ts');
const channels = read('src/shared/contracts/channels.ts');
const tests = read('tests/unit/quick-download.test.ts');
const css = read('src/renderer/src/quick-download.css');

check(
  'Quick Download uses elapsed duration fields',
  !panel.includes('type="time"') &&
    panel.includes('Mốc thời lượng bắt đầu') &&
    panel.includes('Mốc thời lượng kết thúc')
);
check(
  'HH:MM:SS fields have distinct defaults',
  panel.includes('placeholder="00:10:00"') && panel.includes('placeholder="00:13:00"')
);
check(
  'duration values persist across link changes and restart',
  panel.includes('localStorage.getItem') &&
    panel.includes('localStorage.setItem') &&
    !/setStartTime\(\s*['"]00:10:00['"]\s*\)/.test(panel)
);
check(
  'backend accepts hours above 23 and caps the input',
  shared.includes('MAX_QUICK_DOWNLOAD_HOURS = 9_999') && tests.includes('25:10:30')
);
check(
  'QuickDownloadService is managed by AppContext',
  context.includes('new QuickDownloadService(') && ipc.includes('ctx.quickDownload')
);
check(
  'QuickDownloadService uses the central ProcessManager',
  service.includes('this.processes.run({') && !service.includes('spawn(')
);
check(
  'concurrent starts are serialized',
  service.includes('private startTail: Promise<void>') &&
    service.includes('startLocked(rawRequest, forceCookies)')
);
check(
  'pause, resume and cancel control the real process tree',
  service.includes('pauseByJob(taskId)') &&
    service.includes('resumeByJob(taskId)') &&
    service.includes('killByJob(taskId)')
);
check(
  'completion happens only after media verification',
  service.indexOf("phase = 'verifying'") < service.indexOf("phase = 'completed'") &&
    service.includes('this.verifier.verify(')
);
check(
  'output collision protection is enabled',
  command.includes('--no-overwrites') &&
    command.includes('--no-post-overwrites') &&
    command.includes('%(id)s') &&
    command.includes('QD-')
);
check(
  'Quick Download state is recovered as interrupted',
  service.includes("recovered.phase = 'interrupted'") && service.includes('state.json')
);
check(
  'pause/resume channels are exposed through IPC and preload',
  channels.includes("pause: 'quick-download:pause'") &&
    channels.includes("resume: 'quick-download:resume'") &&
    preload.includes('quickDownload.pause') &&
    preload.includes('quickDownload.resume')
);
check('duration input styling exists', css.includes('.video-duration-input'));
check(
  'media modes are available in the shared contract and UI',
  shared.includes("'video-audio'") &&
    shared.includes("'audio-only'") &&
    shared.includes("'video-only'") &&
    panel.includes('Chỉ âm thanh M4A') &&
    panel.includes('Chỉ video, không âm thanh')
);
check(
  'audio-only and video-only commands avoid the wrong merge operation',
  command.includes("request.mediaMode === 'audio-only'") &&
    command.includes("request.mediaMode === 'video-only'") &&
    command.includes("'--extract-audio'") &&
    command.includes('VIDEO_ONLY_SELECTORS')
);
check(
  'subtitle, thumbnail and metadata sidecars are real yt-dlp flags',
  command.includes("'--write-subs'") &&
    command.includes("'--convert-subs'") &&
    command.includes("'--write-thumbnail'") &&
    command.includes("'--write-info-json'")
);
check(
  'stream verification follows the selected media mode',
  service.includes('expectedStreams:') &&
    service.includes("mediaMode !== 'audio-only'") &&
    service.includes("mediaMode !== 'video-only'")
);

check(
  'Timeline is opt-in and hidden until the user enables it',
  panel.includes('checked={useTimeline}') &&
    panel.includes('{useTimeline && (') &&
    panel.includes("mode: useTimeline ? 'range' : 'full'")
);
check(
  'Quick Download restores current state across renderer navigation',
  channels.includes("current: 'quick-download:current'") &&
    preload.includes('quickDownload.current') &&
    service.includes('public currentStatus()')
);
check(
  'global pause and resume include Quick Download',
  ipc.includes('ctx.quickDownload.pauseActive()') && ipc.includes('ctx.quickDownload.resumeActive()')
);
check(
  'other queue work no longer blocks Quick Download start',
  !ipc
    .slice(ipc.indexOf('handle(IPC.quickDownload.start'), ipc.indexOf('handle(IPC.quickDownload.status'))
    .includes('ctx.queue.activeCount()')
);
check(
  'Quick Download classifies authentication failures without showing raw yt-dlp text',
  shared.includes('QuickDownloadErrorCode') &&
    service.includes('classifyCookieFailure(') &&
    service.includes("'AUTHENTICATION_REQUIRED'") &&
    service.includes("'COOKIES_EXPIRED'")
);
check(
  'configured cookies are attached only after the video requests authentication',
  service.includes('QUICK_DOWNLOAD_COOKIES_ATTACHED_ON_DEMAND') &&
    service.includes('hasConfiguredCookies(this.cookieSettings())') &&
    command.includes("'--cookies'") &&
    command.includes("'--cookies-from-browser'")
);
check(
  'saving cookies resumes a blocked Quick Download automatically',
  ipc.includes('await ctx.quickDownload.retryCookieBlocked()') &&
    service.includes('public async retryCookieBlocked()')
);
check(
  'Quick Download opens the shared three-method cookie dialog',
  panel.includes('CookieManagerDialog') &&
    panel.includes('Mở 3 cách thêm cookies') &&
    panel.includes('onConfigured={resumeAfterCookies}')
);
check(
  'cookie errors use a friendly blocking card',
  panel.includes('quick-download-cookie-block') &&
    panel.includes('status.errorCode') &&
    css.includes('.quick-download-cookie-block')
);
check(
  'Quick Download receives the shared SettingsService cookie configuration',
  context.includes("join(this.userData, 'quick-download'),") && context.includes('this.settings')
);

console.log('Quick Download integration verification OK: 27 checks.');
