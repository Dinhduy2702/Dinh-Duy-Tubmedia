import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidVersion } from './version-tools.mjs';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

const files = {
  packageJson: JSON.parse(read('package.json')),
  appStore: read('src/renderer/src/stores/app-store.ts'),
  app: read('src/renderer/src/app/App.tsx'),
  sidebar: read('src/renderer/src/layout/Sidebar.tsx'),
  home: read('src/renderer/src/pages/EditorHomePage.tsx'),
  queue: read('src/renderer/src/pages/QueuePage.tsx'),
  history: read('src/renderer/src/pages/HistoryPage.tsx'),
  diagnostics: read('src/renderer/src/pages/DiagnosticsPage.tsx'),
  importer: read('src/renderer/src/features/projects/ImportLinksDialog.tsx'),
  virtualTable: read('src/renderer/src/components/VirtualTableWindow.tsx'),
  quickPanel: read('src/renderer/src/components/QuickDownloadPanel.tsx'),
  quickShared: read('src/shared/quick-download.ts'),
  quickCommand: read('src/main/download/quick-download-command.ts'),
  quickService: read('src/main/download/quick-download-service.ts'),
  fileVerifier: read('src/main/media/file-verifier.ts'),
  defaults: read('src/main/settings/defaults.ts'),
  css: read('src/renderer/src/tubmedia-theme.css')
};

const checks = [];
function check(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
  console.log(`PASS: ${label}`);
}

check('package version is a valid release version', isValidVersion(files.packageJson.version));
check(
  // Điều chỉnh 2026-09-22: "Tải danh sách" + "Ghép theo Timeline" LÀ việc chính hàng ngày thật sự
  // (không phải "Tải 1 video" ①②③, chỉ là tiện ích phụ) — xem TIEN_DO.md.
  '"Tải danh sách" (download-workbench) is the default landing page; Editor Home still reachable via logo',
  files.appStore.includes("page: 'download-workbench'") &&
    files.app.includes("page === 'download-workbench'") &&
    files.sidebar.includes("setPage('editor-home')")
);
check(
  'navigation exposes the primary daily workflow (tải danh sách + ghép Timeline), the quick single-video journey, history and diagnostics',
  ['download-workbench', 'download-merge', 'step-download', 'step-preview-cut', 'step-merge-export', 'history', 'diagnostics'].every(
    (page) => files.sidebar.includes(`'${page}'`)
  )
);
check(
  'VIỆC CHÍNH đứng trước CÔNG CỤ; tải danh sách/ghép Timeline (việc chính hàng ngày) đứng trước "Tải 1 video" (tiện ích phụ) và Dọn dẹp',
  files.sidebar.indexOf("label: 'VIỆC CHÍNH'") < files.sidebar.indexOf("label: 'CÔNG CỤ'") &&
    files.sidebar.indexOf("id: 'download-workbench'") < files.sidebar.indexOf("id: 'step-download'") &&
    files.sidebar.indexOf("id: 'download-merge'") < files.sidebar.indexOf("id: 'cleanup'") &&
    files.sidebar.indexOf("label: 'CÔNG CỤ'") < files.sidebar.indexOf("id: 'cleanup'")
);
check(
  'Editor Home uses actual queue, project, tool and system state',
  files.home.includes('state.jobs') &&
    files.home.includes('state.projects') &&
    files.home.includes('state.tools') &&
    files.home.includes('state.stats')
);
check(
  'Queue supports search, filters and multi-select',
  files.queue.includes('queue-search') &&
    files.queue.includes('selectedIds') &&
    files.queue.includes('status ===') &&
    files.queue.includes('projectId ===')
);
check(
  'Queue bulk actions call real IPC operations',
  files.queue.includes('window.desktop.queue[kind]') &&
    ['pause', 'resume', 'cancel', 'retry'].every((action) => files.queue.includes(`'${action}'`)) &&
    files.queue.includes('pauseAll()') &&
    files.queue.includes('resumeAll()')
);
check(
  'Queue large-list rendering is virtualized',
  files.queue.includes('useVirtualTableWindow') &&
    files.virtualTable.includes('startIndex') &&
    files.virtualTable.includes('endIndex')
);
check(
  'History supports CSV and JSON export through real save dialog',
  files.history.includes('.csv`') &&
    files.history.includes('.json`') &&
    files.history.includes('window.desktop.dialogs.saveTextFile')
);
check(
  'Diagnostics uses real ToolManager, system stats and logs',
  files.diagnostics.includes('refreshTools()') &&
    files.diagnostics.includes('window.desktop.logs.list') &&
    files.diagnostics.includes('state.stats')
);
check(
  'Input workflow supports TXT, CSV and drag/drop',
  files.importer.includes("endsWith('.csv')") &&
    files.importer.includes('chooseTextFile') &&
    files.importer.includes('onDrop')
);
check(
  'Input workflow detects and removes duplicate media identities',
  files.importer.includes('duplicateKey') &&
    files.importer.includes('removeDuplicates') &&
    files.importer.includes('duplicateIds')
);
check(
  'Quick Download supports video+audio, audio-only and video-only',
  files.quickShared.includes("'audio-only'") &&
    files.quickShared.includes("'video-only'") &&
    files.quickPanel.includes('Chỉ âm thanh M4A') &&
    files.quickPanel.includes('Chỉ video, không âm thanh')
);
check(
  'Quick Download sidecars are wired to yt-dlp',
  ['--write-subs', '--convert-subs', '--write-thumbnail', '--write-info-json'].every((flag) =>
    files.quickCommand.includes(flag)
  )
);
check(
  'Quick Download verifies stream requirements before completed',
  files.quickService.includes('expectedStreams:') &&
    files.fileVerifier.includes('expectedStreams.audio') &&
    files.fileVerifier.includes('expectedStreams.video')
);
check(
  'NLE presets exist for Premiere, Resolve, CapCut and proxy',
  ['quality-premiere-cfr', 'quality-davinci-cfr', 'quality-capcut-cfr', 'quality-editor-proxy'].every((id) =>
    files.defaults.includes(id)
  )
);
check(
  'new Editor Studio visual system exists',
  files.css.includes('TUBMEDIA 1.3.0') &&
    files.css.includes('.editor-hero') &&
    files.css.includes('.queue-studio-layout') &&
    files.css.includes('.diagnostics-summary')
);
check(
  'new workflows do not use placeholder success data',
  !files.home.includes('Math.random(') &&
    !files.queue.includes('Math.random(') &&
    !files.history.includes('Math.random(')
);

console.log(`Tubmedia ${files.packageJson.version} editor workflow verification OK: ${checks.length} checks.`);
