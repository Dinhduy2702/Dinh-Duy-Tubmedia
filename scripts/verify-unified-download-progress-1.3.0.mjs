import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());

async function read(relativePath) {
  return readFile(resolve(root, relativePath), 'utf8');
}

const files = {
  queue: await read('src/renderer/src/pages/QueuePage.tsx'),
  quick: await read('src/renderer/src/components/QuickDownloadPanel.tsx'),
  unified: await read('src/renderer/src/components/UnifiedDownloadProgress.tsx'),
  workbench: await read('src/renderer/src/pages/DownloadWorkbenchPage.tsx'),
  theme: await read('src/renderer/src/tubmedia-theme.css'),
  quickCss: await read('src/renderer/src/quick-download.css')
};

const checks = [
  ['shared progress component exists', files.unified.includes('export function UnifiedDownloadProgress')],
  ['Quick Download uses shared progress', files.quick.includes('<UnifiedDownloadProgress')],
  ['Quick Download uses integrated controls', files.quick.includes('quick-download-unified-progress')],
  ['Queue polls Quick Download status', files.queue.includes('window.desktop.quickDownload.current()')],
  [
    'Queue controls Quick Download process',
    files.queue.includes("onControl('pause')") && files.queue.includes("onControl('cancel')")
  ],
  ['Each workflow renders aggregate progress', files.queue.includes('queue-workflow-total-progress')],
  ['Each workflow has an animated expander', files.queue.includes('queue-workflow-expander')],
  ['Workflow child progress is collapsible', files.queue.includes('queue-workflow-collapse')],
  [
    'Queue keeps virtualized child rendering',
    files.queue.includes('useVirtualTableWindow(jobs, 108, 520, 8, true)')
  ],
  [
    'Queue row combines title status progress and actions',
    files.queue.includes('queue-task-stack') && files.queue.includes('queue-row-progress')
  ],
  [
    'List download keeps aggregate progress',
    files.workbench.includes('progress.toFixed(1)}% toàn danh sách')
  ],
  [
    'All progress fills animate smoothly',
    /transition:\s*width\s+(?:0?\.34s|340ms)\s+cubic-bezier\(\s*0?\.22\s*,\s*0?\.61\s*,\s*0?\.36\s*,\s*1\s*\)/.test(
      files.theme
    ) && files.theme.includes('will-change: width')
  ],
  [
    'Accordion opens without layout jump',
    files.theme.includes('grid-template-rows: 0fr') && files.theme.includes('grid-template-rows: 1fr')
  ],
  ['Expander arrow rotates', files.theme.includes(".queue-workflow-expander[aria-expanded='true'] svg")],
  [
    'Quick Download ready state matches workflow layout',
    files.quickCss.includes('.quick-download-ready-progress')
  ]
];

let failed = 0;
for (const [label, passed] of checks) {
  if (passed) console.log(`PASS: ${label}`);
  else {
    failed += 1;
    console.error(`FAIL: ${label}`);
  }
}

if (failed > 0) throw new Error(`Unified download progress verification failed: ${failed} lỗi.`);
console.log(`Unified download progress verification OK: ${checks.length} checks.`);
