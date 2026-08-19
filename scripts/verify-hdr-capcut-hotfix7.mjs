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

const engine = text('src/main/downloader/download-engine.ts');
const defaults = text('src/main/settings/defaults.ts');
const settings = text('src/main/settings/settings-service.ts');
const pkg = JSON.parse(text('package.json'));
const marker = engine.indexOf('HDR_CAPCUT_HOTFIX7_MASTER_PRESERVED');
const end = engine.indexOf('\n  private async prepareDownloadedFile(', marker);
const method = marker >= 0 && end > marker ? engine.slice(marker, end) : '';

check(marker >= 0 && method.length > 0, 'CapCut master-preserving method is integrated');
check(method.includes('.capcut-edit-${Date.now()}.mp4'), 'edit copy uses a separate sidecar path');
check(
  ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'].every((encoder) => method.includes(`'${encoder}'`)),
  'runtime encoder fallback covers NVIDIA, Intel, AMD and CPU'
);
check(method.includes("'-fps_mode'") && method.includes("'cfr'"), 'CapCut edit copy uses constant frame rate');
check(method.includes("'-force_key_frames'") && method.includes('n_forced*1'), 'CapCut edit copy uses one-second seek-friendly GOPs');
check(method.includes("'yuv420p'") && method.includes("'avc1'"), 'CapCut edit copy uses H.264 8-bit compatibility tags');
check(method.includes('requiresHdrToneMap') && method.includes('tonemap=hable'), 'HDR is tone-mapped only in the SDR edit copy');
check(!/await\s+rm\(input\b/.test(method), 'CapCut method never deletes the master input');
check(!/await\s+rename\(input\b/.test(method), 'CapCut method never replaces the master input');
check(method.includes('ADAPTIVE_SETTINGS_HOTFIX8_EDIT_PLAN'), 'edit policy is independent from source selection');
check(
  defaults.includes("downloadCompatibilityMode: 'source'") &&
    defaults.includes("downloadEditCopyMode: 'off'"),
  'fresh defaults preserve highest-source quality and wait for user acceptance'
);
check(settings.includes('adaptive_master_edit_recommendation_v131_hotfix8'), 'existing installs receive a safe one-time policy reset');
check(
  pkg.scripts?.['verify:hdr-capcut'] === 'node scripts/verify-hdr-capcut-hotfix7.mjs' &&
    String(pkg.scripts?.check ?? '').includes('verify:hdr-capcut'),
  'HDR/CapCut verifier remains permanent in npm run check'
);

if (failures > 0) {
  throw new Error(`HDR/CapCut verification failed: ${failures}/${checks} checks failed.`);
}
console.log(`Tubmedia HDR/CapCut verification OK: ${checks} checks.`);