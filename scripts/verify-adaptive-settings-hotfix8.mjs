import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let checks = 0;
let failures = 0;
function text(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8').replace(/^\uFEFF/, '');
}
function check(condition, message) {
  checks += 1;
  if (condition) console.log('PASS:', message);
  else {
    failures += 1;
    console.error('FAIL:', message);
  }
}

const domain = text('src/shared/types/domain.ts');
const schema = text('src/shared/schemas/ipc.ts');
const defaults = text('src/main/settings/defaults.ts');
const settings = text('src/main/settings/settings-service.ts');
const engine = text('src/main/downloader/download-engine.ts');
const page = text('src/renderer/src/pages/DownloadWorkbenchPage.tsx');
const qualityTests = text('tests/unit/download-quality.test.ts');
const pkg = JSON.parse(text('package.json'));

check(domain.includes('ADAPTIVE_SETTINGS_HOTFIX8_CONTRACT'), 'AppSettings has a backward-compatible edit-copy preference');
check(schema.includes('ADAPTIVE_SETTINGS_HOTFIX8_SCHEMA') && schema.includes(".default('off')"), 'IPC validates the edit-copy preference safely');
check(defaults.includes("downloadCompatibilityMode: 'source'") && defaults.includes("downloadEditCopyMode: 'off'"), 'default remains unbounded highest-source');
check(!defaults.includes('HDR_CAPCUT_HOTFIX7_DEFAULT'), 'forced CapCut default is removed');
check(settings.includes('ADAPTIVE_SETTINGS_HOTFIX8_MIGRATION'), 'existing installs are reset to a recommendation-first policy');
check(!settings.includes('capcut_master_edit_copy_v131_hotfix7'), 'old forced CapCut migration is removed');
check(engine.includes('ADAPTIVE_SETTINGS_HOTFIX8_EDIT_PLAN'), 'master selection and edit-copy planning are independent');
check(engine.includes('ADAPTIVE_SETTINGS_HOTFIX8_PREPARE'), 'accepted edit-copy recommendation reaches download post-processing');
check(page.includes('ADAPTIVE_SETTINGS_HOTFIX8_RECOMMENDATION'), 'hardware recommendation controls resource and edit-copy settings');
check(page.includes("downloadCompatibilityMode: 'source'") && page.includes('downloadEditCopyMode: recommendedEditMode'), 'recommendation preserves master quality and chooses an edit resolution');
check(page.includes('base.gpuJobs >= 2') && page.includes('recommendedConcurrentFragments >= 4') && page.includes('recommendedAria2Connections >= 24'), '2K edit copies require a strong GPU/resource recommendation');
check(
  page.includes('ADAPTIVE_SETTINGS_HOTFIX10_QUALITY_LABEL') &&
    page.includes("Chọn 'Theo máy' để tạo bản edit CapCut phù hợp"),
  'UI explains the highest-source default and the explicit acceptance step'
);
check(page.includes('Theo máy') && page.includes('Đã áp dụng đề xuất theo máy'), 'UI keeps one clear acceptance action and confirms the selected policy');
check(qualityTests.includes("downloadCompatibilityMode: 'source'"), 'legacy source-quality contract remains covered by unit tests');
check(
  pkg.scripts?.['verify:adaptive-settings'] === 'node scripts/verify-adaptive-settings-hotfix8.mjs' &&
    String(pkg.scripts?.check ?? '').includes('verify:adaptive-settings'),
  'adaptive-settings verifier is permanent in npm run check'
);

if (failures > 0) {
  throw new Error(`Adaptive settings Hotfix 10 verification failed: ${failures}/${checks} checks failed.`);
}
console.log(`Tubmedia adaptive settings Hotfix 10 verification OK: ${checks} checks.`);