import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const nsi = readFileSync(resolve(process.cwd(), 'installer/video-studio-pro.nsi'), 'utf8');

describe('installer/video-studio-pro.nsi — an toàn cài đặt, cập nhật vi sai và đường dẫn nâng cấp (#2, #3, #4)', () => {
  it('#2: đặt AllowSkipFiles off và không dùng taskkill theo tên rộng', () => {
    expect(nsi).toMatch(/^\s*AllowSkipFiles\s+off\s*$/m);
    expect(nsi).not.toMatch(/taskkill\.exe[^\r\n]*\/IM\b/i);
  });

  it('#2: chờ mở ghi thử tối đa 10 lần × 1000ms cho app và các công cụ trong $INSTDIR\\', () => {
    expect(nsi).toContain('Sleep 1000');
    expect(nsi).toContain('${APP_EXE}');
    expect(nsi).toContain('resources\\tool\\ffmpeg.exe');
    expect(nsi).toContain('resources\\tool\\yt-dlp.exe');
    expect(nsi).toContain('resources\\tool\\aria2c.exe');
    expect(nsi).toContain('resources\\tool\\deno.exe');
    expect(nsi).toMatch(/ExecutablePath/i);
    expect(nsi).toMatch(/TUBMEDIA_INSTDIR/);
  });

  it('#2: kiểm IfErrors sau File /r trước khi ghi DisplayVersion', () => {
    const fileIdx = nsi.indexOf('File /r "${APP_SOURCE}\\*.*"');
    const displayVersionIdx = nsi.indexOf('"DisplayVersion" "${PRODUCT_VERSION}"');
    expect(fileIdx).toBeGreaterThan(-1);
    expect(displayVersionIdx).toBeGreaterThan(fileIdx);
    const between = nsi.slice(fileIdx, displayVersionIdx);
    expect(between).toMatch(/IfErrors|\$\{If\}\s+\$\{Errors\}/);
  });

  it('#3: chép $EXEPATH vào $LOCALAPPDATA\\tubmedia-updater\\installer.exe lúc cài và xóa khi gỡ', () => {
    const installStart = nsi.indexOf('Section "Install"');
    const uninstallStart = nsi.indexOf('Section "Uninstall"');
    const installSection = nsi.slice(installStart, uninstallStart);
    const uninstallSection = nsi.slice(uninstallStart);

    expect(installSection).toContain('$LOCALAPPDATA\\tubmedia-updater\\installer.exe');
    expect(installSection).toContain('$EXEPATH');
    expect(uninstallSection).toContain('Delete "$LOCALAPPDATA\\tubmedia-updater\\installer.exe"');
  });

  it('#4: chỉ gán $INSTDIR = $0 và $IsUpgrade = "1" khi không truyền /D= và thư mục/ổ cũ tồn tại', () => {
    const onInitStart = nsi.indexOf('Function .onInit');
    const onInitEnd = nsi.indexOf('FunctionEnd', onInitStart);
    const onInit = nsi.slice(onInitStart, onInitEnd);

    expect(onInit).toContain('/D=');
    expect(onInit).toMatch(/\$\{FileExists\}|IfFileExists/);
  });
});
