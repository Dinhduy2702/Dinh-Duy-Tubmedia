import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string) => readFile(resolve(process.cwd(), path), 'utf8');

describe('required tool bootstrap', () => {
  it('prepares required tools without preventing the dev UI from opening', async () => {
    const pkg = JSON.parse(await readProjectFile('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toContain('tools:prepare-dev:windows');
    expect(pkg.scripts['tools:prepare-dev:windows']).toContain('-Mode repair-required');
    expect(pkg.scripts['tools:prepare-dev:windows']).toContain('-SoftFail');
    expect(pkg.scripts['tools:repair-required:windows']).toContain('-Mode repair-required');
    expect(pkg.scripts['tools:repair-required:windows']).not.toContain('-SoftFail');
  });

  it('serializes automatic repair and retries on task start', async () => {
    const manager = await readProjectFile('src/main/tools/tool-manager.ts');
    const workbench = await readProjectFile('src/main/workbench/workbench-service.ts');
    expect(manager).toContain('requiredReadyTail');
    expect(manager).toContain('ensureRequiredReady()');
    expect(workbench).toContain('this.tools.ensureRequiredReady()');
  });

  it('handles Windows Application Control before validating downloaded tools', async () => {
    const script = await readProjectFile('scripts/tools-windows.ps1');
    const updater = await readProjectFile('src/main/updates/tool-update-service.ts');
    expect(script).toContain('Unblock-File');
    expect(script).toContain(':Zone.Identifier');
    expect(script).toContain("Invoke-WingetInstall 'Gyan.FFmpeg'");
    expect(script).toContain('Import-ExistingFfmpegSuite');
    expect(updater).toContain('clearWindowsInternetMark');
    expect(updater).toContain('Do not execute a freshly downloaded binary from the staging folder');
    expect(updater.indexOf('await rename(temporary, destination)')).toBeLessThan(
      updater.indexOf('await this.validateCandidate(toolName, destination)')
    );
  });

  it('does not let optional ffplay block required FFmpeg repair', async () => {
    const updater = await readProjectFile('src/main/updates/tool-update-service.ts');
    expect(updater).toContain("toolName !== 'ffplay'");
    expect(updater).toContain("(['ffmpeg', 'ffprobe'] as ToolName[])");
    expect(updater).toContain('this.updatePackage(packageName, true)');
  });

  it('uses direct official fallbacks and download retries', async () => {
    const updater = await readProjectFile('src/main/updates/tool-update-service.ts');
    expect(updater).toContain('releases/latest/download/yt-dlp.exe');
    expect(updater).toContain('releases/download/latest/ffmpeg-master-latest-win64-gpl.zip');
    expect(updater).toContain('attempt <= 3');
    expect(updater).toContain('TOOL_DOWNLOAD_RETRY');
  });

  it('discovers WinGet packages even when their command shim is missing', async () => {
    const manager = await readProjectFile('src/main/tools/tool-manager.ts');
    expect(manager).toContain('wingetPackageCandidates');
    expect(manager).toContain("join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')");
    expect(manager).toContain("['Gyan.FFmpeg', 'BtbN.FFmpeg']");
  });

  it('copies required tools into the project payload even when PATH already has FFmpeg', async () => {
    const script = await readProjectFile('scripts/tools-windows.ps1');
    expect(script).toContain('function Test-BundledTool');
    expect(script).toContain('$BundledBefore = Get-BundledHealth');
    expect(script).toContain("$NeedYt = $Mode -eq 'update' -or -not (($BundledBefore | Where-Object Name -eq 'yt-dlp').Ok)");
    expect(script).toContain("$NeedFfmpeg = $Mode -eq 'update' -or -not (($BundledBefore | Where-Object Name -eq 'ffmpeg').Ok)");
    expect(script).toContain('$BundledRequiredBroken = $BundledAfter');
    expect(script).toContain('were not copied into the installer payload');
  });

  it('requires runnable tools before building the installer', async () => {
    const release = await readProjectFile('scripts/build-release-windows.ps1');
    expect(release).toContain('Bảo đảm bộ công cụ bắt buộc được đóng gói cùng installer');
    expect(release).toContain("@('yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe')");
    expect(release).toContain('tools:repair-required:windows');
  });
});
