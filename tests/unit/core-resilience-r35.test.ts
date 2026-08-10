import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Tubmedia core resilience contract R35', () => {
  it('keeps the permanent resilience release gate enabled', () => {
    const packageJson = JSON.parse(source('package.json')) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.['verify:core-resilience']).toBe('node scripts/verify-core-resilience-1.3.0.mjs');
    expect(packageJson.scripts?.check).toContain('npm run verify:core-resilience');
  });
  it('uses strict merge signatures, source decode, final integrity and safe commit', () => {
    const concat = source('src/shared/utils/concat-compatibility.ts');
    const merge = source('src/main/merge/merge-engine.ts');
    const normalize = source('src/main/normalize/normalize-engine.ts');
    const verifier = source('src/main/media/file-verifier.ts');
    expect(concat).toContain("['Video extradata'");
    expect(concat).toContain("['Time base'");
    expect(merge).toContain("this.verifier.verify(item.path, 'deep'");
    expect(normalize).toContain("'-xerror', '-err_detect', 'explode'");
    expect(normalize).toContain('TUBMEDIA VERIFIED CACHE REUSE R35');
    expect(normalize).toContain("operation: 'remux-v4-core-resilience'");
    expect(normalize).toContain("'-video_track_timescale', '90000'");
    expect(normalize).toContain('forceAudioTranscode = false');
    expect(merge).toContain('TUBMEDIA PROVEN FAST PATH R35');
    expect(merge).toContain('forceUniformAudio');
    expect(merge).toContain('canonicalizeTimeBase');
    expect(verifier).toContain("'blackdetect=d=0.08:pix_th=0.02,freezedetect=n=-60dB:d=1'");
    expect(merge).toContain("phase: 'av-sync-verification'");
    expect(merge).toContain('commitFileWithoutOverwrite(pending, final)');
  });
  it('keeps recovery, update, tool, backup and diagnostic safety as invariants', () => {
    expect(source('src/main/queue/queue-manager.ts')).toContain('TUBMEDIA RACE SAFE RESUME R29');
    expect(source('src/main/updates/app-update-service.ts')).toContain('allowDowngrade = false');
    expect(source('src/main/updates/tool-update-service.ts')).toContain('không có SHA-256 được công bố');
    expect(source('src/main/backups/backup-service.ts')).toContain('PRAGMA integrity_check');
    expect(source('src/main/logging/diagnostic-exporter.ts')).toContain('redactSecretText');
  });
});
