import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function source(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('Tubmedia 1.2.0 smart merge and safe UI release gates', () => {
  it('skips re-encoding for compatible sources and remuxes before any expensive fallback', async () => {
    const [merge, normalize] = await Promise.all([
      source('src/main/merge/merge-engine.ts'),
      source('src/main/normalize/normalize-engine.ts')
    ]);

    expect(merge).toContain('Tất cả nguồn tương thích · bỏ qua mã hóa lại');
    expect(merge).toContain('Ghép nhanh bằng stream copy');
    expect(merge).toContain('remuxForConcat');
    expect(merge).toContain('resource.normalizeWorkers');
    expect(merge).toContain('resource.remuxWorkers');
    expect(normalize).toContain('NORMALIZE_CACHE_HIT');
    expect(normalize).toContain('REMUX_CACHE_HIT');
    expect(normalize).toMatch(/'-c'\s*,\s*'copy'/);
  });

  it('preserves content without implicit upscale or crop', async () => {
    const normalize = await source('src/main/normalize/normalize-engine.ts');

    expect(normalize).toContain('force_original_aspect_ratio=decrease');
    expect(normalize).toContain('pad=${target.width}:${target.height}');
    expect(normalize).toContain('MERGE_NO_UPSCALE_PADDING');
    expect(normalize).toContain("filters.push('setsar=1'");
    expect(normalize).not.toContain('force_original_aspect_ratio=increase');
    expect(normalize).not.toContain('crop=${target.width}:${target.height}');
  });

  it('offers safe removal and refuses to delete an output directory', async () => {
    const [queue, page, dialog] = await Promise.all([
      source('src/main/queue/queue-manager.ts'),
      source('src/renderer/src/pages/QueuePage.tsx'),
      source('src/renderer/src/components/ConfirmDialog.tsx')
    ]);

    expect(queue).toContain('deleteOutput = false');
    expect(queue).toContain('if (!outputInfo.isFile())');
    expect(queue).toContain('tránh xóa nhầm thư mục');
    expect(page).toContain('Chỉ xóa khỏi danh sách');
    expect(page).toContain('Xóa khỏi danh sách và xóa tệp');
    expect(dialog).toContain('secondaryLabel');
  });

  it('packages an update feed, creates latest.yml and closes the old executable before overwrite', async () => {
    const [pkgText, updateConfig, build, nsis] = await Promise.all([
      source('package.json'),
      source('resources/app-update.yml'),
      source('scripts/build-installer-windows.ps1'),
      source('installer/video-studio-pro.nsi')
    ]);
    const pkg = JSON.parse(pkgText) as {
      build: { extraResources?: Array<{ from: string; to: string }> };
    };

    expect(pkg.build.extraResources).toContainEqual({
      from: 'resources/app-update.yml',
      to: 'app-update.yml'
    });
    expect(updateConfig).toContain('provider: github');
    expect(updateConfig).toContain('repo: Dinh-Duy-Tubmedia');
    expect(build).toContain('Create GitHub updater metadata');
    expect(build).toContain('latest.yml');
    expect(nsis).toContain('taskkill.exe /F /T /IM');
    expect(nsis).toContain('--force-run');
  });
});
