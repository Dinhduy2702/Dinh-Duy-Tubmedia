import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const checks = [];

function check(label, condition) {
  if (!condition) {
    throw new Error(`FAIL: ${label}`);
  }

  checks.push(label);
  console.log(`PASS: ${label}`);
}

const sidebar = read('src/renderer/src/layout/Sidebar.tsx');
const app = read('src/renderer/src/app/App.tsx');
const store = read('src/renderer/src/stores/app-store.ts');
const page = read('src/renderer/src/pages/SystemCleanupPage.tsx');
const panel = read('src/renderer/src/components/SystemCleanupPanel.tsx');
const css = read('src/renderer/src/system-cleanup.css');
const helper = read('resources/system-cleanup-helper.ps1');

check('sidebar exposes a dedicated cleanup page', sidebar.includes("id: 'cleanup'"));
check('app renders the cleanup route', app.includes("page === 'cleanup'"));
check('page id contract includes cleanup', store.includes("'cleanup'"));
check('cleanup page renders the cleanup panel', page.includes('<SystemCleanupPanel />'));
check('UI displays estimated storage', panel.includes('Dung lượng tìm thấy'));
check('UI displays safety levels', panel.includes('Rất an toàn') && panel.includes('Cần kiểm tra'));
check('UI displays cleanup urgency', panel.includes('Mức độ cần dọn'));
check(
  'delete is locked until a matching scan completes',
  panel.includes('lastScannedKey === currentScanKey')
);
check('whole-machine scan remains explicit', panel.includes('Quét thông minh toàn bộ máy'));
check('dangerous user folders remain documented as protected', panel.includes('Zalo Received Files'));
check('cleanup safety styles exist', css.includes('.cleanup-safety-guide'));
check('helper still blocks broad roots', helper.includes('Assert-SafeTarget'));
check('helper still protects Zalo Received Files', helper.includes('Zalo Received Files'));

console.log(`Cleanup navigation and safety UI verification OK: ${checks.length} checks.`);
