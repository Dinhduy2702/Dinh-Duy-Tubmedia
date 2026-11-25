import fs from 'node:fs';

// 1.8.0 việc A: bộ chạy JavaScript Deno kèm sẵn cho yt-dlp — kiểm ghim phiên bản/SHA, bước đóng gói và tham số truyền cho yt-dlp.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const prepare = String(pkg.scripts?.['prepare:deno'] || '');
const dist = String(pkg.scripts?.['dist:nsis-safe'] || '');
const checkScript = String(pkg.scripts?.check || '');
const ensure = fs.readFileSync('scripts/ensure-bundled-deno.ps1', 'utf8');
const installer = fs.readFileSync('scripts/build-installer-windows.ps1', 'utf8');
const gitignore = fs.readFileSync('.gitignore', 'utf8');
const read = (path) => fs.readFileSync(path, 'utf8');
const runtime = read('src/main/downloader/ytdlp-js-runtime.ts');

let checks = 0;
let failures = 0;
function check(condition, label) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  }
}

check(prepare.includes('ensure-bundled-deno.ps1'), 'prepare:deno owns the bundled Deno bootstrap');
check(dist.includes('npm run prepare:deno'), 'official NSIS build prepares Deno before packaging');
check(
  dist.indexOf('npm run prepare:deno') < dist.indexOf('build-installer-windows.ps1'),
  'Deno preparation runs before installer packaging'
);
check(ensure.includes('"tool"') && ensure.includes('deno.exe'), 'Deno is copied to the project tool payload');
check(ensure.includes('$Version = "2.9.8"'), 'Deno Windows x64 release version is pinned');
check(ensure.includes('deno-x86_64-pc-windows-msvc.zip'), 'official Windows x64 Deno archive is used');
check(ensure.includes('https://github.com/denoland/deno/releases/download/'), 'Deno downloads only from the official GitHub release');
check(
  ensure.includes('CBA84B26E0DF5AE7F74FC66B86A95B866872A86292EBD84FA1E959927EDD93BF'),
  'Deno archive SHA-256 is pinned'
);
check(
  ensure.includes('SHA256') &&
    ensure.indexOf('-ne $ExpectedZipSha256') > 0 &&
    ensure.indexOf('-ne $ExpectedZipSha256') < ensure.indexOf('Expand-ZipPortable -LiteralPath $zip'),
  'Deno archive is checksum verified before extraction'
);
check(installer.includes("File = 'deno.exe'"), 'installer build refuses a package without deno.exe');
check(/^tool\/\*\.exe$/m.test(gitignore), 'deno.exe binary stays out of git like aria2c.exe');
check(checkScript.includes('npm run verify:bundled-deno'), 'bundled Deno verifier is permanent in npm run check');

// Tham số --js-runtimes được dựng ở MỘT chỗ và truyền ở mọi lần gọi yt-dlp với URL.
check(runtime.includes("'--js-runtimes', `deno:${denoPath}`"), 'shared helper builds --js-runtimes deno:<path>');
check(runtime.includes('YTDLP_JS_RUNTIMES_MIN_VERSION'), 'old yt-dlp without --js-runtimes is not broken');
check(
  read('src/main/tools/tool-manager.ts').includes("registerBundledDenoFolders([join(this.resourcesPath, 'tool'), join(this.toolRoot, 'tool')])"),
  'ToolManager registers resources\\tool and project tool folders for deno.exe'
);
for (const [path, needle] of [
  ['src/main/downloader/download-engine.ts', 'args.push(...ytDlpJsRuntimeArguments(ytdlp))'],
  ['src/main/download/quick-download-service.ts', "jsRuntimeArgs: ytDlpJsRuntimeArguments(this.tools.get('yt-dlp'))"],
  ['src/main/download/quick-download-command.ts', 'args.push(...options.jsRuntimeArgs)'],
  ['src/main/download/preview-frame-service.ts', 'ytDlpJsRuntimeArguments(ytdlp)'],
  ['src/main/download/preview-frame-command.ts', '...jsRuntimeArgs,'],
  ['src/main/media/video-link-filter-service.ts', 'ytDlpJsRuntimeArguments(tool)'],
  ['src/main/index.ts', "'YTDLP_JS_RUNTIME'"]
]) {
  check(read(path).includes(needle), `${path} passes the bundled JS runtime (${needle})`);
}
check(fs.existsSync('tool/deno.exe'), 'source build payload currently contains deno.exe (npm run prepare:deno)');

if (failures) {
  throw new Error(`Bundled Deno verifier failed ${failures}/${checks}`);
}

console.log(`Tubmedia bundled Deno verification OK: ${checks} checks.`);
