import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFile(resolve(root, path), 'utf8');
const base = spawnSync(process.execPath, ['scripts/verify-release-candidate.mjs'], {
  cwd: root,
  stdio: 'inherit'
});
if (base.status !== 0) process.exit(base.status ?? 1);

const expectedVersion = '1.2.3';
const packageJson = JSON.parse(await read('package.json'));
const packageLock = JSON.parse(await read('package-lock.json'));
const constants = await read('src/shared/constants/app.ts');
const queue = await read('src/main/queue/queue-manager.ts');
const queuePage = await read('src/renderer/src/pages/QueuePage.tsx');
const downloadPage = await read('src/renderer/src/pages/DownloadWorkbenchPage.tsx');
const mergePage = await read('src/renderer/src/pages/DownloadMergePage.tsx');
const toolsPage = await read('src/renderer/src/pages/ToolsPage.tsx');
const normalize = await read('src/main/normalize/normalize-engine.ts');
const styles = await read('src/renderer/src/styles.css');
const buildScript = await read('BUILD_INSTALLER_CHINH_THUC.ps1');
const changelog = await read('CHANGELOG.md');
const appUpdateConfig = await read('resources/app-update.yml');
const windowsInstallerScript = await read('scripts/build-installer-windows.ps1');
const nsisInstaller = await read('installer/video-studio-pro.nsi');
const confirmDialog = await read('src/renderer/src/components/ConfirmDialog.tsx');
const preloadApi = await read('src/preload/index.ts');

const checks = [
  ['package version 1.2.3', packageJson.version === expectedVersion],
  [
    'package-lock version 1.2.3',
    packageLock.version === expectedVersion && packageLock.packages?.['']?.version === expectedVersion
  ],
  ['renderer label v1.2.3', constants.includes("APP_VERSION_LABEL = 'v1.2.3'")],
  ['changelog 1.2.3 first', changelog.startsWith('# Tubmedia 1.2.3')],
  ['official build targets 1.2.3', buildScript.includes('Download video Tubmedia-Setup-1.2.3-x64.exe')],
  [
    'GitHub updater configured',
    Array.isArray(packageJson.build?.publish) && packageJson.build.publish[0]?.provider === 'github'
  ],
  [
    'bundled updater config targets official repo',
    appUpdateConfig.includes('provider: github') &&
      appUpdateConfig.includes('owner: Dinhduy2702') &&
      appUpdateConfig.includes('repo: Dinh-Duy-Tubmedia')
  ],
  [
    'updater config is packaged',
    Array.isArray(packageJson.build?.extraResources) &&
      packageJson.build.extraResources.some(
        (entry) => entry?.from === 'resources/app-update.yml' && entry?.to === 'app-update.yml'
      )
  ],
  [
    'Windows build creates latest.yml metadata',
    windowsInstallerScript.includes('Create GitHub updater metadata') &&
      windowsInstallerScript.includes('latest.yml') &&
      windowsInstallerScript.includes('SHA512')
  ],
  [
    'installer closes old app before overwrite',
    nsisInstaller.includes('taskkill.exe /F /T /IM') && nsisInstaller.includes('Sleep 1500')
  ],
  [
    'silent updater can force app relaunch',
    nsisInstaller.includes('Function .onInstSuccess') && nsisInstaller.includes('--force-run')
  ],
  [
    'no-upscale and content-preserving fit retained',
    normalize.includes('force_original_aspect_ratio=decrease') &&
      normalize.includes('pad=${target.width}:${target.height}') &&
      !normalize.includes('force_original_aspect_ratio=increase') &&
      !normalize.includes('crop=${target.width}:${target.height}')
  ],
  [
    'completed stage is synchronized',
    queue.includes("const finalStage = completionStatus === 'skipped' ? 'Đã tải trước đó' : 'Đã hoàn tất'") &&
      queue.includes('progressPhases: progressPhases')
  ],
  ['queue sorted by status', queuePage.includes('return rank(a) - rank(b)')],
  [
    'queue has expand details',
    queuePage.includes('Mở chi tiết tiến trình') && queuePage.includes('queue-detail-row')
  ],
  ['queue has universal delete', queuePage.includes('title="Xóa tác vụ"')],
  [
    'queue delete offers safe file choice',
    queuePage.includes('Chỉ xóa khỏi danh sách') &&
      queuePage.includes('Xóa khỏi danh sách và xóa tệp') &&
      confirmDialog.includes('secondaryLabel') &&
      preloadApi.includes('deleteOutput')
  ],
  [
    'download workflows use tabs',
    downloadPage.includes('workflow-tabs') && downloadPage.includes('activeLane')
  ],
  ['merge workflows use tabs', mergePage.includes('workflow-tabs') && mergePage.includes('activeLane')],
  [
    'new lanes inherit paths',
    downloadPage.includes("loadWorkbenchPath('download-output')") &&
      mergePage.includes("loadWorkbenchPath('merge-output')")
  ],
  [
    'tool update button is conditional',
    toolsPage.includes('updateInfo?.available') && toolsPage.includes('Mới nhất')
  ],
  [
    'responsive constraints exist',
    styles.includes('.workflow-tabs') && styles.includes('.queue-detail-grid')
  ],
  [
    'smart normalize cache exists',
    normalize.includes('NORMALIZE_CACHE_HIT') && normalize.includes('REMUX_CACHE_HIT')
  ],
  [
    'official build runs typecheck lint tests',
    ['npm.cmd run typecheck', 'npm.cmd run lint', 'npm.cmd run test', 'npm.cmd run test:integration'].every(
      (x) => buildScript.includes(x)
    )
  ]
];
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Tubmedia 1.2.3 stable verification failed:');
  for (const [name] of failed) console.error(`- ${name}`);
  process.exit(1);
}
console.log(`Tubmedia 1.2.3 stable verification OK: ${checks.length} checks.`);
