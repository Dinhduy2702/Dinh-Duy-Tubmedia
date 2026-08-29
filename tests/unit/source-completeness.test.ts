import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeSourceBytesForHash,
  isRootGitMetadataPath,
  sourceSha256
} from '../../scripts/source-inventory-hash.mjs';

describe('source completeness', () => {
  it('has no missing import, installer file, asset, secret or version mismatch', () => {
    const script = join(process.cwd(), 'scripts/verify-source-completeness.mjs');
    const result = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    expect(
      result.status,
      `${result.stdout}
${result.stderr}`
    ).toBe(0);
    expect(result.stdout).toContain('Source completeness verification OK');
  });

  it('uses the same source hash for LF and Windows CRLF checkouts', () => {
    const lf = Buffer.from('first line\nsecond line\n', 'utf8');
    const crlf = Buffer.from('first line\r\nsecond line\r\n', 'utf8');

    expect(sourceSha256(crlf)).toBe(sourceSha256(lf));
    expect(canonicalizeSourceBytesForHash(crlf)).toEqual(lf);
  });

  it('does not normalize binary payload bytes', () => {
    const binary = Buffer.from([0, 13, 10, 255]);
    const expected = createHash('sha256').update(binary).digest('hex').toUpperCase();

    expect(sourceSha256(binary)).toBe(expected);
    expect(canonicalizeSourceBytesForHash(binary)).toEqual(binary);
  });

  it('allows only Git metadata at the source root', () => {
    expect(isRootGitMetadataPath('.git')).toBe(true);
    expect(isRootGitMetadataPath('.git/objects/pack')).toBe(true);
    expect(isRootGitMetadataPath('.git\\HEAD')).toBe(true);
    expect(isRootGitMetadataPath('nested/.git')).toBe(false);
  });
});
