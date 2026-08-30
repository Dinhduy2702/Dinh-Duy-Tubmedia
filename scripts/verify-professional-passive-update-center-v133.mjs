import fs from 'node:fs';

const main = fs.readFileSync('src/main/updates/app-update-service.ts', 'utf8');
const page = fs.readFileSync('src/renderer/src/pages/UpdatesPage.tsx', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

let total = 0;
let failed = 0;

function check(ok, label) {
  total += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failed += 1;
}

check(
  main.includes('TUBMEDIA_V133_PASSIVE_UPDATE_CENTER'),
  'main updater owns passive background-check policy'
);

check(
  !/baseStatus\('checking'[\s\S]{0,180}this\.emit/s.test(main),
  'main updater never emits visible checking state'
);

check(
  main.includes('APP_UPDATE_BACKGROUND_CHECK_STARTED') && main.includes('APP_UPDATE_BACKGROUND_CHECK'),
  'automatic polling remains observable in technical logs'
);

check(
  main.includes('if (silent)') &&
    main.includes('return this.status;') &&
    main.includes('Fail passive: keep the last stable update state.'),
  'silent network failures preserve the last stable update status'
);

check(
  main.includes('APP_UPDATE_CHECK_TIMEOUT') && main.includes('Yêu cầu mạng tiếp tục chạy nền.'),
  'network timeout remains bounded and continues asynchronously'
);

check(
  !main.includes("message: 'Đang tải bản cập nhật trong nền...'") &&
    main.includes("message: 'Đang tải bản cập nhật...'"),
  'foreground update download wording is no longer described as background UX'
);

check(
  main.includes("updater.on('update-available'") && main.includes("this.baseStatus('available'"),
  'confirmed newer release still reaches the visible available state'
);

check(
  main.includes("updater.on('update-not-available'") && main.includes("'not-available'"),
  'confirmed current release still reaches stable latest-version state'
);

check(
  main.includes("updater.on('download-progress'") && main.includes("state: 'downloading'"),
  'real update downloads still emit progress'
);

check(
  page.includes('TUBMEDIA_V133_PROFESSIONAL_PASSIVE_UPDATE_CENTER'),
  'Update Center owns professional passive UX marker'
);

check(
  page.includes('Thử kiểm tra lại') && page.includes('updates.check()'),
  'Update Center has an explicit manual check/retry action'
);

check(
  page.includes('Đang kiểm tra phiên bản mới') && page.includes('RefreshCcw'),
  'manual check exposes a bounded spinner/message only inside Update Center'
);

check(
  page.includes('PHIÊN BẢN HIỆN TẠI') && page.includes('PHIÊN BẢN TRÊN MÁY CHỦ'),
  'Update Center always presents current and server-known version'
);

check(
  page.includes('Đã có phiên bản mới') && page.includes('Cập nhật ngay'),
  'confirmed new release exposes one clear update CTA'
);

check(
  page.includes("state === 'downloading'") && page.includes('Đang tải {Math.round(progress)}%'),
  'download progress appears only for a real update transfer'
);

check(
  page.includes("state === 'error'") && page.includes('Cần thử lại'),
  'real manual check errors remain actionable without becoming startup popups'
);

check(
  page.includes('LAST_KNOWN_RELEASE_KEY') && page.includes('localStorage'),
  'latest-known release survives renderer navigation/restart cache'
);

check(
  String(pkg.scripts?.check || '').includes('npm run verify:professional-passive-update-center'),
  'professional passive-update verifier is permanent in npm run check'
);

if (failed) {
  throw new Error(`Professional passive update verifier failed ${failed}/${total}`);
}

console.log(`Tubmedia professional passive Update Center OK: ${total} checks.`);
