import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function readProjectFile(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('installer upgrade identity', () => {
  it('keeps package identity equal to the permanent installer identity', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      author: string;
      build: { appId: string; productName: string };
    };
    const identity = JSON.parse(await readProjectFile('installer/identity.json')) as {
      appId: string;
      companyName: string;
      installRegistryKey: string;
      productName: string;
    };

    expect(packageJson.build.appId).toBe(identity.appId);
    expect(packageJson.build.productName).toBe(identity.productName);
    expect(packageJson.author).toBe(identity.companyName);
    expect(identity.installRegistryKey).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it('finds the previous InstallLocation and skips choosing a new folder during upgrade', async () => {
    const script = await readProjectFile('installer/video-studio-pro.nsi');

    expect(script).toContain('InstallDirRegKey HKCU "${INSTALL_REGISTRY_KEY}"');
    expect(script).toContain(
      'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}'
    );
    expect(script).toContain(
      'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${LEGACY_APP_ID}'
    );
    expect(script).toContain('StrCpy $INSTDIR "$0"');
    expect(script).toContain('StrCpy $IsUpgrade "1"');
    expect(script).toContain('MUI_PAGE_CUSTOMFUNCTION_PRE SkipDirectoryPageForUpgrade');
    expect(script).toContain('Function SkipDirectoryPageForUpgrade');
    expect(script).toContain('SetOverwrite on');
    expect(script).toContain('Section "Uninstall"');
    expect(script).not.toContain('Section "Gỡ cài đặt"');
  });

  it('closes the installed app before overwriting and can relaunch after silent updater install', async () => {
    const script = await readProjectFile('installer/video-studio-pro.nsi');

    expect(script).toContain('taskkill.exe /F /T /IM "${APP_EXE}"');
    expect(script).toContain('Function .onInstSuccess');
    expect(script).toContain('--force-run');
    expect(script).toContain("Exec '\"$INSTDIR\\${APP_EXE}\"'");
  });

  it('build refuses an accidental app id or product name change', async () => {
    const script = await readProjectFile('scripts/build-installer-windows.ps1');

    expect(script).toContain('package.json build.appId must remain');
    expect(script).toContain('package.json build.productName must remain');
    expect(script).toContain('installer\\identity.json');
    expect(script).toContain('Prepare required bundled tools');
    expect(script).toContain('-Mode repair-required');
    expect(script).not.toContain('-Mode repair-required -SoftFail');
  });

  it('maps SemVer prerelease versions to a numeric Windows file version', async () => {
    const buildScript = await readProjectFile('scripts/build-installer-windows.ps1');
    const nsisScript = await readProjectFile('installer/video-studio-pro.nsi');

    expect(buildScript).toContain('function ConvertTo-WindowsFileVersion');
    expect(buildScript).toContain("$windowsFileVersion = ConvertTo-WindowsFileVersion -Version $productVersion");
    expect(buildScript).toContain('1.0.0-rc.7 -> 1.0.0.7');
    expect(buildScript).toContain('!define PRODUCT_FILE_VERSION');
    expect(nsisScript).toContain('VIProductVersion "${PRODUCT_FILE_VERSION}"');
    expect(nsisScript).not.toContain('VIProductVersion "${PRODUCT_VERSION}.0"');
    expect(nsisScript).toContain('"FileVersion" "${PRODUCT_VERSION}"');
    expect(nsisScript).toContain('"ProductVersion" "${PRODUCT_VERSION}"');
  });

  it('source update archive is created without a version wrapper folder', async () => {
    const script = await readProjectFile('scripts/build-source-update.ps1');

    expect(script).toContain('CreateFromDirectory');
    expect(script).toContain('$false');
    expect(script).toContain('package.json is not at archive root');
    expect(script).toContain('version-named wrapper folder');
    expect(script).toContain('node_modules|out|release|tmp|test-results|tool');
  });
});
