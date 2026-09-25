import { existsSync, readFileSync } from 'node:fs';
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
const scanner = read('src/main/system/cleanup-scanner.ts');

check('sidebar exposes a dedicated cleanup page', sidebar.includes("id: 'cleanup'"));
check('app renders the cleanup route', app.includes("page === 'cleanup'"));
check('page id contract includes cleanup', store.includes("'cleanup'"));
check('cleanup page renders the cleanup panel', page.includes('<SystemCleanupPanel />'));
check('UI displays estimated storage', panel.includes('Dung lượng tìm thấy'));
check('UI displays safety levels', panel.includes('Rất an toàn') && panel.includes('An toàn có kiểm soát'));
check('UI displays cleanup urgency', panel.includes('Mức độ cần dọn'));
check(
  'delete button is gated on a fresh matching scan (disabled={!canClean}) and opens a real confirm dialog, no whole-machine/UAC controls remain',
  panel.includes('Dọn dẹp và xóa file đã chọn') &&
    panel.includes('disabled={!canClean}') &&
    panel.includes('<ConfirmDialog') &&
    !panel.includes('Quét và phân loại toàn bộ máy') &&
    !panel.includes('wholeMachine') &&
    !panel.includes('systemCleanupRequiresAdmin') &&
    !/window\.(?:confirm|prompt|alert)\(/.test(panel)
);
check(
  'admin-required maintenance is listed as info-only with a link to Windows Storage Sense',
  panel.includes('SYSTEM_CLEANUP_ADMIN_INFO_ITEMS') && panel.includes('openStorageSettings')
);
check(
  'quarantine/restore UI is wired (list + restore selected/all)',
  panel.includes('quarantineList') && panel.includes('quarantineRestore') && panel.includes('Hoàn tác tất cả')
);
check('dangerous user folders remain documented as protected', panel.includes('Zalo Received Files'));
check('cleanup safety styles exist', css.includes('.cleanup-safety-guide'));
check('cleanup admin-info styles exist', css.includes('.system-cleanup-admin-info'));
check('scanner still blocks broad roots', scanner.includes('assertSafeCleanupPath'));
check('scanner still protects Zalo Received Files', scanner.includes('Zalo Received Files'));
check(
  'PowerShell helper for cleanup no longer exists (GĐ4a removed it entirely)',
  !existsSync(join(root, 'resources/system-cleanup-helper.ps1'))
);

console.log(`Cleanup navigation and safety UI verification OK: ${checks.length} checks.`);
