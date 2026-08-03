import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('source completeness', () => {
  it('has no missing import, installer file, asset, secret or version mismatch', () => {
    const script = join(process.cwd(), 'scripts/verify-source-completeness.mjs');
    const result = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    expect(result.status, `${result.stdout}
${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Source completeness verification OK');
  });
});
