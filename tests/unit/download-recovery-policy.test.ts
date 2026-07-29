import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_LIST_POLICY_VERSION,
  REFERENCE_1080P_FORMAT_SELECTOR
} from '../../src/shared/utils/download-quality.js';

describe('download recovery and quality fallback policy', () => {
  it('prioritizes separate high-resolution streams before low-resolution combined fallbacks', () => {
    const branches = REFERENCE_1080P_FORMAT_SELECTOR.split('/');
    expect(branches[0]).toContain('height>=720');
    expect(branches[0]).toContain('+ba');
    expect(branches.indexOf('b[height<=1080]')).toBeGreaterThan(0);
    expect(REFERENCE_1080P_FORMAT_SELECTOR.endsWith('bv*+ba/b')).toBe(true);
    expect(DOWNLOAD_LIST_POLICY_VERSION).toBe('download-list-multiplatform-v5');
  });

  it('clears missing cache paths and treats accepted minimum fallback as information', async () => {
    const engine = await readFile(join(process.cwd(), 'src/main/downloader/download-engine.ts'), 'utf8');
    const repository = await readFile(
      join(process.cwd(), 'src/main/database/repositories/media-source-repository.ts'),
      'utf8'
    );

    expect(repository).toContain('clearFileCache');
    expect(repository).toContain('source_file=NULL');
    expect(engine).toContain("'SOURCE_CACHE_MISSING'");
    expect(engine).toContain('this.sources.clearFileCache(source.id)');
    expect(engine).toContain("'SOURCE_CACHE_CORRUPT'");
    expect(engine).toContain("'DOWNLOAD_QUALITY_FALLBACK'");
    expect(engine).toContain('fallbackAccepted: acceptedMinimumFallback');
  });
});
