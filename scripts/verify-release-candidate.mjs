import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFile(resolve(root, path), 'utf8');
const packageJson = JSON.parse(await read('package.json'));
const identity = JSON.parse(await read('installer/identity.json'));
const files = Object.fromEntries(
  await Promise.all(
    [
      'src/main/updates/app-update-service.ts',
      'src/main/updates/tool-update-service.ts',
      'src/main/tools/tool-manager.ts',
      'src/main/workbench/workbench-service.ts',
      'src/main/app/app-context.ts',
      'src/main/index.ts',
      'src/main/queue/queue-manager.ts',
      'src/main/windows/main-window.ts',
      'src/main/backups/backup-service.ts',
      'src/main/logging/logger.ts',
      'src/renderer/src/components/AttentionCenter.tsx',
      'src/renderer/src/components/CompactDetail.tsx',
      'src/renderer/src/components/CompactLogRow.tsx',
      'src/renderer/src/components/JobProgressList.tsx',
      'src/renderer/src/hooks/use-desktop-events.ts',
      'src/renderer/src/app/App.tsx',
      'src/renderer/src/layout/Sidebar.tsx',
      'src/renderer/src/pages/UpdatesPage.tsx',
      'src/renderer/src/pages/QueuePage.tsx',
      'src/renderer/src/pages/LogsPage.tsx',
      'src/renderer/src/pages/DownloadMergePage.tsx',
      'src/renderer/src/tubmedia-theme.css',
      'src/shared/utils/notification-policy.ts',
      'tests/unit/startup-fast.test.ts',
      'scripts/build-release-windows.ps1',
      'scripts/build-installer-windows.ps1',
      'installer/video-studio-pro.nsi',
      'scripts/tools-windows.ps1',
      'scripts/create-release-config.mjs',
      'scripts/verify-v0100.mjs',
      'scripts/verify-v0101.mjs'
    ].map(async (path) => [path, await read(path)])
  )
);

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}
function has(path, value) {
  return files[path].includes(value);
}

check(
  'version is valid SemVer v1 or newer',
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version) &&
    Number(packageJson.version.split('.')[0]) >= 1
);
check('permanent app id is unchanged', packageJson.build.appId === identity.appId);
check('permanent product name is unchanged', packageJson.build.productName === identity.productName);
check('NSIS differential updates are enabled', packageJson.build.nsis?.differentialPackage === true);
check(
  'installer preserves user data on uninstall',
  packageJson.build.nsis?.deleteAppDataOnUninstall === false
);
check(
  'v0 installer location migrates into the standard updater installer',
  packageJson.build.nsis?.include === 'installer/electron-builder-upgrade.nsh' &&
    (await read('installer/electron-builder-upgrade.nsh')).includes('Software\\Tubmedia\\DownloadVideo')
);
check(
  'electron-updater CommonJS bridge is ESM-safe and lazy in dev',
  has('src/main/updates/app-update-service.ts', 'createRequire(import.meta.url)') &&
    has('src/main/updates/app-update-service.ts', "requireFromEsm('electron-updater')") &&
    has('src/main/updates/app-update-service.ts', 'if (!app.isPackaged)') &&
    !has('src/main/updates/app-update-service.ts', 'import { autoUpdater')
);
check(
  'auto updater waits for user approval',
  has('src/main/updates/app-update-service.ts', 'updater.autoDownload = false')
);
check(
  'update install is blocked while jobs run',
  has('src/main/updates/app-update-service.ts', 'this.queue.activeCount() > 0')
);
check(
  'update backup uses bounded update category',
  has('src/main/updates/app-update-service.ts', "create(undefined, false, 'update')")
);
check(
  'updater owns the final quit after clean shutdown',
  has('src/main/updates/app-update-service.ts', 'await this.prepareForInstall()') &&
    has('src/main/index.ts', 'NSIS updater')
);
check('update page is routed', has('src/renderer/src/app/App.tsx', "page === 'updates'"));
check('update page is in sidebar', has('src/renderer/src/layout/Sidebar.tsx', "id: 'updates'"));
check(
  'notifications have entering/visible/leaving phases',
  ['attention-entering', 'attention-visible', 'attention-leaving'].every((value) =>
    has('src/renderer/src/tubmedia-theme.css', value)
  )
);
check(
  'critical errors remain until resolved or dismissed',
  has(
    'src/renderer/src/components/AttentionCenter.tsx',
    'Boolean(error || (attention?.sticky && !attentionResolved))'
  ) && has('src/renderer/src/components/AttentionCenter.tsx', 'isAttentionNoticeResolved(attention, jobs)')
);
check(
  'notification timeout is severity-aware',
  has('src/shared/utils/notification-policy.ts', 'notificationDuration')
);
check(
  'renderer events are batched',
  has('src/renderer/src/hooks/use-desktop-events.ts', 'const JOB_FLUSH_MS = 150')
);
check(
  'React StrictMode is not used in final renderer',
  !has('src/renderer/src/app/App.tsx', 'StrictMode') &&
    !(await read('src/renderer/src/main.tsx')).includes('StrictMode')
);
check(
  'queue scheduler cannot overlap ticks',
  has('src/main/queue/queue-manager.ts', 'private tickRunning = false')
);
check(
  'queue idle polling is reduced',
  has('src/main/queue/queue-manager.ts', 'this.active.size > 0 ? 350 : 1_000')
);
check(
  'system sleep is blocked only while work is active',
  has('src/main/index.ts', "powerSaveBlocker.start('prevent-app-suspension')")
);
check(
  'renderer is sandboxed',
  has('src/main/windows/main-window.ts', 'sandbox: true') &&
    has('src/main/windows/main-window.ts', 'contextIsolation: true')
);
check('web permissions are denied by default', has('src/main/index.ts', 'setPermissionRequestHandler'));
check('stale file logs are pruned', has('src/main/logging/logger.ts', 'pruneFiles(retentionDays'));
check(
  'file logs are buffered off the main interaction path',
  has('src/main/logging/logger.ts', 'pendingWrites = new Map') &&
    has('src/main/logging/logger.ts', 'await this.fileWriteTail')
);
check(
  'shutdown flushes buffered logs before closing sqlite',
  has('src/main/index.ts', 'await current.logger.flush()') &&
    has('src/main/index.ts', 'await activeContext.logger.flush()')
);
check(
  'automatic update backups are bounded',
  has('src/main/backups/backup-service.ts', 'pruneUpdateBackups')
);
check(
  'storage polling slows down when idle or hidden',
  ['20_000', '4_000', '12_000'].every((value) => has('src/renderer/src/pages/DownloadMergePage.tsx', value))
);
check(
  'dark theme is black/red',
  has('src/renderer/src/tubmedia-theme.css', '--bg: #08090c') &&
    has('src/renderer/src/tubmedia-theme.css', '--accent: #e50920')
);
check(
  'light theme is white/red',
  has('src/renderer/src/tubmedia-theme.css', '--bg: #f7f7f8') &&
    has('src/renderer/src/tubmedia-theme.css', '--accent: #d9071d')
);
check(
  'toast transitions avoid animated blur under load',
  has('src/renderer/src/tubmedia-theme.css', 'v1.0.0 RC1 final smoothness pass') &&
    has('src/renderer/src/tubmedia-theme.css', 'filter: none !important')
);
check(
  'RC6 clears all known lint regressions without disabling rules',
  has('scripts/create-release-config.mjs', "import { URL } from 'node:url'") &&
    has('scripts/verify-v0100.mjs', "import { URL } from 'node:url'") &&
    has('scripts/verify-v0101.mjs', "import { URL } from 'node:url'") &&
    has('src/main/app/app-context.ts', '= () => Promise.resolve()') &&
    has('src/main/updates/app-update-service.ts', 'import type { AppUpdater, ProgressInfo, UpdateInfo }') &&
    !has('src/main/updates/app-update-service.ts', "typeof import('electron-updater')") &&
    !has('src/main/logging/logger.ts', 'renameSync')
);
check(
  'RC7 keeps long progress and log details out of fixed-height rows',
  has('src/renderer/src/components/CompactDetail.tsx', 'createPortal(') &&
    has('src/renderer/src/components/CompactDetail.tsx', 'onMouseEnter={openFromHover}') &&
    has('src/renderer/src/pages/QueuePage.tsx', 'queue-message-compact') &&
    has(
      'src/renderer/src/pages/QueuePage.tsx',
      'const discloseMessage = Boolean(issue || (messageDetail && messageDetail.length > 72))'
    ) &&
    has('src/renderer/src/pages/QueuePage.tsx', '<StatusBadge status={job.status} fixed/>') &&
    has('src/renderer/src/pages/LogsPage.tsx', 'logs-message-compact') &&
    has('src/renderer/src/components/CompactLogRow.tsx', 'log-row-message') &&
    has('src/renderer/src/tubmedia-theme.css', '/* v1.0.0 RC7 — tiến trình và nhật ký gọn') &&
    has('src/renderer/src/tubmedia-theme.css', 'table-layout: fixed')
);
check(
  'RC8 maps SemVer prerelease to a valid four-part Windows file version',
  has('scripts/build-installer-windows.ps1', 'function ConvertTo-WindowsFileVersion') &&
    has(
      'scripts/build-installer-windows.ps1',
      '$windowsFileVersion = ConvertTo-WindowsFileVersion -Version $productVersion'
    ) &&
    has('scripts/build-installer-windows.ps1', '!define PRODUCT_FILE_VERSION') &&
    has('scripts/build-installer-windows.ps1', '1.0.0-rc.7 -> 1.0.0.7') &&
    has('installer/video-studio-pro.nsi', 'VIProductVersion "${PRODUCT_FILE_VERSION}"') &&
    !has('installer/video-studio-pro.nsi', 'VIProductVersion "${PRODUCT_VERSION}.0"')
);
check(
  'release requires HTTPS feed',
  has('scripts/create-release-config.mjs', "parsed.protocol !== 'https:'")
);
check(
  'release requires updater metadata and blockmap',
  has('scripts/build-release-windows.ps1', 'latest.yml/beta.yml') &&
    has('scripts/build-release-windows.ps1', '*.blockmap')
);
check(
  'release uses local electron-builder',
  has('scripts/build-release-windows.ps1', 'node_modules\\.bin\\electron-builder.cmd')
);
check(
  'dev tool preparation is soft-fail so the UI can still open under Application Control',
  packageJson.scripts?.dev?.includes('tools:prepare-dev:windows') &&
    packageJson.scripts?.['tools:prepare-dev:windows']?.includes('-SoftFail') &&
    packageJson.scripts?.['tools:repair-required:windows']?.includes('-Mode repair-required') &&
    !packageJson.scripts?.['tools:repair-required:windows']?.includes('-SoftFail')
);
check(
  'tool readiness is serialized and can repair on demand',
  has('src/main/tools/tool-manager.ts', 'ensureRequiredReady()') &&
    has('src/main/tools/tool-manager.ts', 'requiredReadyTail')
);
check(
  'startup test follows the current required-tool bootstrap API',
  has('tests/unit/startup-fast.test.ts', 'current.tools.ensureRequiredReady()') &&
    has('tests/unit/startup-fast.test.ts', 'current.tools.healthCheckOptional()') &&
    !has('tests/unit/startup-fast.test.ts', "expect(main).toContain('healthCheckRequired()')")
);
check(
  'workbench retries required tool repair before rejecting a task',
  has('src/main/workbench/workbench-service.ts', 'this.tools.ensureRequiredReady()')
);
check(
  'tool updater falls back to official direct downloads',
  has('src/main/updates/tool-update-service.ts', 'TOOL_RELEASE_API_DIRECT_FALLBACK') &&
    has(
      'src/main/updates/tool-update-service.ts',
      'releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
    )
);
check(
  'tool downloads retry before giving up',
  has('src/main/updates/tool-update-service.ts', 'TOOL_DOWNLOAD_RETRY') &&
    has('src/main/updates/tool-update-service.ts', 'attempt <= 3')
);
check(
  'Windows downloaded tools are unblocked and validated only after final installation',
  has('scripts/tools-windows.ps1', 'Unblock-File') &&
    has('scripts/tools-windows.ps1', ':Zone.Identifier') &&
    has('src/main/updates/tool-update-service.ts', 'clearWindowsInternetMark') &&
    files['src/main/updates/tool-update-service.ts'].indexOf('await rename(temporary, destination)') <
      files['src/main/updates/tool-update-service.ts'].indexOf(
        'await this.validateCandidate(toolName, destination)'
      )
);
check(
  'optional ffplay cannot block required ffmpeg and ffprobe repair',
  has('src/main/updates/tool-update-service.ts', "toolName !== 'ffplay'") &&
    has('src/main/updates/tool-update-service.ts', "(['ffmpeg', 'ffprobe'] as ToolName[])") &&
    has('src/main/updates/tool-update-service.ts', 'this.updatePackage(packageName, true)')
);
check(
  'tool repair can reuse old trusted copies and fall back to WinGet',
  has('scripts/tools-windows.ps1', 'Import-ExistingFfmpegSuite') &&
    has('scripts/tools-windows.ps1', "Invoke-WingetInstall 'Gyan.FFmpeg'") &&
    has('src/main/tools/tool-manager.ts', 'wingetPackageCandidates')
);
check(
  'release build refuses to continue without bundled required tools',
  has('scripts/build-release-windows.ps1', 'Bảo đảm bộ công cụ bắt buộc được đóng gói cùng installer') &&
    has('scripts/build-release-windows.ps1', 'ffprobe.exe')
);
check(
  'safe NSIS build prepares required tools in strict mode before packaging',
  has('scripts/build-installer-windows.ps1', 'Prepare required bundled tools') &&
    has('scripts/build-installer-windows.ps1', '-Mode repair-required') &&
    !has('scripts/build-installer-windows.ps1', '-Mode repair-required -SoftFail')
);
check(
  'RC9 update checks fail fast without a feed and never leave the UI waiting indefinitely',
  has('src/main/updates/app-update-service.ts', "BUNDLED_UPDATE_CONFIG = 'app-update.yml'") &&
    has('src/main/updates/app-update-service.ts', 'APP_UPDATE_FEED_NOT_CONFIGURED_FAST') &&
    has('src/main/updates/app-update-service.ts', 'MANUAL_UPDATE_CHECK_TIMEOUT_MS = 8_000') &&
    has('src/main/updates/app-update-service.ts', 'SILENT_UPDATE_CHECK_TIMEOUT_MS = 5_000') &&
    has('src/main/updates/app-update-service.ts', 'networkCheckInFlight') &&
    has('src/main/updates/app-update-service.ts', 'waitForNetworkCheck')
);

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  for (const item of failed) console.error(`FAIL: ${item.name}`);
  throw new Error(`${failed.length}/${checks.length} release checks failed.`);
}
console.log(`Tubmedia ${packageJson.version} release verification OK: ${checks.length} checks.`);
