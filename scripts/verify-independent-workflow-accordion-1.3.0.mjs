import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const read = (file) => readFile(resolve(root, file), 'utf8');

const files = {
  manager: await read('src/main/queue/queue-manager.ts'),
  lane: await read('src/shared/utils/queue-lane.ts'),
  queue: await read('src/renderer/src/pages/QueuePage.tsx'),
  workbench: await read('src/renderer/src/pages/DownloadWorkbenchPage.tsx'),
  theme: await read('src/renderer/src/tubmedia-theme.css')
};

const checks = [
  ['per-project download helper exists', files.lane.includes('independentDownloadProjectCanStart')],
  [
    'download-list uses independent project capacity',
    files.manager.includes("if (lane === 'download-list')") &&
      files.manager.includes('independentDownloadProjectCanStart(activeOfProjectType, profile)')
  ],
  [
    'merge workflow still has a bounded shared lane',
    files.manager.includes("if (lane === 'merge-workflow')") &&
      files.manager.includes('mergeSourceDownloadLimit')
  ],
  [
    'workbench explains independent parallel lists',
    files.workbench.includes('bắt đầu độc lập và chạy song song')
  ],
  ['workflow aggregate card exists', files.queue.includes('queue-workflow-total-progress')],
  [
    'animated arrow expander exists',
    files.queue.includes('queue-workflow-expander') && files.theme.includes('transform: rotate(180deg)')
  ],
  [
    'child list expands below parent',
    files.queue.includes('queue-workflow-collapse') && files.theme.includes('grid-template-rows: 1fr')
  ],
  [
    'large child lists remain virtualized',
    files.queue.includes('useVirtualTableWindow(jobs, 108, 520, 8, true)')
  ],
  [
    'group controls are isolated',
    files.queue.includes('runGroup') && files.queue.includes('Các danh sách khác vẫn chạy độc lập.')
  ],
  ['mobile layout exists', files.theme.includes('@media (max-width: 720px)')]
];

let failures = 0;
for (const [label, passed] of checks) {
  if (passed) console.log(`PASS: ${label}`);
  else {
    failures += 1;
    console.error(`FAIL: ${label}`);
  }
}

if (failures > 0) throw new Error(`Independent workflow accordion verification failed: ${failures} lỗi.`);
console.log(`Independent workflow accordion verification OK: ${checks.length} checks.`);
