import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function file(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

describe('Tubmedia release update system', () => {
  it('wires a typed update center into navigation and renderer events', async () => {
    const [app, sidebar, store, hook, domain] = await Promise.all([
      file('src/renderer/src/app/App.tsx'),
      file('src/renderer/src/layout/Sidebar.tsx'),
      file('src/renderer/src/stores/app-store.ts'),
      file('src/renderer/src/hooks/use-desktop-events.ts'),
      file('src/shared/types/domain.ts')
    ]);

    expect(app).toContain("page === 'updates'");
    expect(sidebar).toContain("id: 'updates'");
    expect(store).toContain('updateStatus: AppUpdateStatus | null');
    expect(hook).toContain('setUpdateStatus(status)');
    expect(domain).toContain('export interface AppUpdateStatus');
  });

  it('batches renderer event storms instead of rerendering for every progress line', async () => {
    const hook = await file('src/renderer/src/hooks/use-desktop-events.ts');
    const store = await file('src/renderer/src/stores/app-store.ts');

    expect(hook).toContain('pendingJobs = new Map');
    expect(hook).toContain('JOB_FLUSH_MS');
    expect(hook).toContain('pendingLogs');
    expect(store).toContain('updateJobs(jobs: QueueJob[])');
    expect(store).toContain('sameJob');
  });

  it('respects sticky notices and has controlled enter/exit phases', async () => {
    const notice = await file('src/renderer/src/components/AttentionCenter.tsx');
    const css = await file('src/renderer/src/tubmedia-theme.css');

    expect(notice).toContain("type Phase = 'entering' | 'visible' | 'leaving'");
    expect(notice).toContain('attention?.sticky');
    expect(notice).toContain('onMouseEnter={() => setPaused(true)}');
    expect(css).toContain('.attention-leaving');
    expect(css).toContain('@keyframes attention-life');
  });

  it('keeps the official installer command separate from the updater publishing pipeline', async () => {
    const [pkgText, buildScript, configScript] = await Promise.all([
      file('package.json'),
      file('scripts/build-release-windows.ps1'),
      file('scripts/create-release-config.mjs')
    ]);
    const pkg = JSON.parse(pkgText) as {
      scripts: Record<string, string>;
      build: { appId: string; nsis: { differentialPackage: boolean } };
    };

    expect(pkg.scripts.dist).toBe('npm run dist:official');
    expect(pkg.scripts['release:windows']).toContain('scripts/build-release-windows.ps1');
    expect(pkg.build.appId).toBe('com.tubmedia.download-video');
    expect(pkg.build.nsis.differentialPackage).toBe(true);
    expect(buildScript).toContain('latest.yml/beta.yml');
    expect(buildScript).toContain('*.blockmap');
    expect(configScript).toContain("provider: 'generic'");
    expect(configScript).toContain('TUBMEDIA_UPDATE_URL');
    expect(buildScript).toContain('electron-builder.cmd');
  });

  it('loads electron-updater through a CommonJS bridge without crashing the ESM main process', async () => {
    const updater = await file('src/main/updates/app-update-service.ts');

    expect(updater).toContain('createRequire(import.meta.url)');
    expect(updater).toContain("requireFromEsm('electron-updater')");
    expect(updater).toContain('if (!app.isPackaged)');
    expect(updater).not.toContain('import { autoUpdater');
  });

  it('fails fast when a test installer has no update feed and bounds slow network checks', async () => {
    const updater = await file('src/main/updates/app-update-service.ts');

    expect(updater).toContain("BUNDLED_UPDATE_CONFIG = 'app-update.yml'");
    expect(updater).toContain('hasConfiguredUpdateSource()');
    expect(updater).toContain('APP_UPDATE_FEED_NOT_CONFIGURED_FAST');
    expect(updater).toContain('MANUAL_UPDATE_CHECK_TIMEOUT_MS = 8_000');
    expect(updater).toContain('SILENT_UPDATE_CHECK_TIMEOUT_MS = 5_000');
    expect(updater).toContain('networkCheckInFlight');
    expect(updater).toContain('waitForNetworkCheck');
  });

  it('treats missing remote updater metadata as a non-blocking feed state', async () => {
    const updater = await file('src/main/updates/app-update-service.ts');

    expect(updater).toContain('isRemoteUpdateMetadataMissing');
    expect(updater).toContain('APP_UPDATE_METADATA_NOT_PUBLISHED');
    expect(updater).toContain('feedUnavailableForSession');
    expect(updater).toContain('feedUnavailableLogged');
    expect(updater).toContain('UPDATE_METADATA_UNAVAILABLE_MESSAGE');
    expect(updater).toContain('this.logger.info(');
    expect(updater).toContain("...this.baseStatus('disabled', UPDATE_METADATA_UNAVAILABLE_MESSAGE)");
    expect(updater).toContain('error: null');
    expect(updater).toContain('if (this.feedUnavailableForSession)');
  });
});
