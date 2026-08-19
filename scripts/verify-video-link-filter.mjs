import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const checks = [];

function pass(name) {
  checks.push({ name, ok: true });
  console.log(`PASS: ${name}`);
}

function fail(name) {
  checks.push({ name, ok: false });
  console.error(`FAIL: ${name}`);
}

async function text(relative) {
  return readFile(join(root, relative), 'utf8');
}

const requiredFiles = [
  'src/shared/video-link-filter.ts',
  'src/shared/utils/video-link-filter.ts',
  'src/main/media/video-link-filter-service.ts',
  'src/renderer/src/pages/VideoLinkFilterPage.tsx',
  'src/renderer/src/video-link-filter.css',
  'tests/unit/video-link-filter.test.ts'
];

for (const relative of requiredFiles) {
  try {
    await text(relative);
    pass(`có ${relative}`);
  } catch {
    fail(`thiếu ${relative}`);
  }
}

const channels = await text('src/shared/contracts/channels.ts');
if (
  channels.includes("videoFilter: {") &&
  channels.includes("chooseLinksFile: 'video-filter:choose-links-file'") &&
  channels.includes("run: 'video-filter:run'") &&
  channels.includes("saveReport: 'video-filter:save-report'")
) pass('IPC video-filter có choose/run/report');
else fail('IPC video-filter có choose/run/report');

const schemas = await text('src/shared/schemas/ipc.ts');
if (
  schemas.includes('videoLinkFilterRequestSchema') &&
  schemas.includes("mode: z.enum(['preview', 'move'])") &&
  schemas.includes('linksText: z.string().min(1).max(10_000_000)') &&
  schemas.includes('.strict()')
) pass('request schema video-filter được validate chặt');
else fail('request schema video-filter được validate chặt');

const register = await text('src/main/ipc/register-ipc.ts');
if (
  register.includes("VideoLinkFilterService") &&
  register.includes('videoLinkFilterRequestSchema') &&
  register.includes('IPC.videoFilter.chooseLinksFile') &&
  register.includes('IPC.videoFilter.run') &&
  register.includes('IPC.videoFilter.saveReport') &&
  register.includes("request.mode === 'move'") &&
  register.includes('ctx.queue.activeCount() > 0') &&
  register.includes('ctx.quickDownload.isActive()')
) pass('main IPC chặn chuyển file khi workflow khác đang chạy');
else fail('main IPC chặn chuyển file khi workflow khác đang chạy');

const service = await text('src/main/media/video-link-filter-service.ts');
if (
  service.includes("this.tools.get('yt-dlp')") &&
  service.includes('VIDEO_LINK_FILTER_EXTENSIONS') &&
  service.includes('matchVideoByLinks') &&
  service.includes('uniqueDestination') &&
  service.includes('.pending') &&
  service.includes('sourceStat.size !== pendingStat.size') &&
  service.includes('await rm(source)') &&
  service.includes('fileSystemErrorCode') &&
  !service.includes("String((error as { code?: unknown }).code ?? '')")
) pass('service dùng yt-dlp bundled + move an toàn + không ghi đè');
else fail('service dùng yt-dlp bundled + move an toàn + không ghi đè');

const utility = await text('src/shared/utils/video-link-filter.ts');
if (
  utility.includes('videoFilenameContainsId') &&
  utility.includes('score >= 0.92') &&
  utility.indexOf('videoFilenameContainsId') < utility.indexOf('score >= 0.92') &&
  utility.includes('directVideoFilterIds')
) pass('matching ưu tiên ID trước title threshold cao');
else fail('matching ưu tiên ID trước title threshold cao');

const preload = await text('src/preload/index.ts');
const apiTypes = await text('src/preload/api-types.ts');
if (
  preload.includes('videoFilter: {') &&
  preload.includes('IPC.videoFilter.chooseLinksFile') &&
  preload.includes('IPC.videoFilter.run') &&
  preload.includes('IPC.videoFilter.saveReport') &&
  apiTypes.includes('VideoLinkFilterRequest') &&
  apiTypes.includes('VideoLinkFilterResult') &&
  apiTypes.includes('videoFilter: {')
) pass('preload bridge chỉ expose API video-filter có type');
else fail('preload bridge chỉ expose API video-filter có type');

const appStore = await text('src/renderer/src/stores/app-store.ts');
const sidebar = await text('src/renderer/src/layout/Sidebar.tsx');
const app = await text('src/renderer/src/app/App.tsx');
const main = await text('src/renderer/src/main.tsx');
if (
  appStore.includes("'filter-by-links'") &&
  sidebar.includes("id: 'filter-by-links'") &&
  sidebar.includes("label: 'Lọc video theo link'") &&
  app.includes("page === 'filter-by-links'") &&
  app.includes('VideoLinkFilterPage') &&
  main.includes("import './video-link-filter.css';")
) pass('trang Lọc video theo link được nối vào sidebar/router/style');
else fail('trang Lọc video theo link được nối vào sidebar/router/style');

const page = await text('src/renderer/src/pages/VideoLinkFilterPage.tsx');
if (
  page.includes("run('preview')") &&
  page.includes("run('move')") &&
  page.includes('previewKey === currentKey') &&
  page.includes('ConfirmDialog') &&
  page.includes('saveReport') &&
  page.includes('unmatchedLinks')
) pass('UI bắt xem trước trước khi chuyển và có xác nhận/báo cáo');
else fail('UI bắt xem trước trước khi chuyển và có xác nhận/báo cáo');

const pkg = JSON.parse(await text('package.json'));
if (
  pkg.scripts?.['verify:video-link-filter'] === 'node scripts/verify-video-link-filter.mjs' &&
  String(pkg.scripts?.check ?? '').includes('npm run verify:video-link-filter')
) pass('video-filter được gắn vào permanent npm check');
else fail('video-filter được gắn vào permanent npm check');

const failed = checks.filter((item) => !item.ok);
if (failed.length > 0) {
  throw new Error(`Video link filter integration verification failed: ${failed.length} lỗi.`);
}
console.log(`Tubmedia video link filter integration OK: ${checks.length} checks.`);
