import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureTubmediaOwnedDirectory } from '../../src/main/files/file-ownership.js';

const probeBase = join(process.cwd(), '.tubmedia-test-runtime', `merge-checkpoint-ownership-${process.pid}`);
const explicitRoot = join(probeBase, 'Tubmedia');
const allowed = join(explicitRoot, 'merge-checkpoints');
const sibling = join(explicitRoot, 'NOT-merge-checkpoints');
const nestedAllowed = join(explicitRoot, 'merge-checkpoints', 'nested');
const wrongRoot = join(probeBase, 'NotTubmedia');
const wrongRootTarget = join(wrongRoot, 'merge-checkpoints');
const escapeTarget = join(explicitRoot, '..', 'outside');

afterEach(async () => {
  await rm(probeBase, { recursive: true, force: true });
});

describe('Hotfix 13 scoped merge-checkpoint ownership', () => {
  it('accepts the merge-checkpoints directory under the explicit Tubmedia root', async () => {
    await Promise.resolve().then(() =>
      ensureTubmediaOwnedDirectory(allowed, 'merge-checkpoints', explicitRoot)
    );
  });

  it('accepts descendants of merge-checkpoints under the explicit Tubmedia root', async () => {
    await Promise.resolve().then(() =>
      ensureTubmediaOwnedDirectory(nestedAllowed, 'merge-checkpoints', explicitRoot)
    );
  });

  it('rejects a sibling folder under the same explicit Tubmedia root', async () => {
    await expect(
      Promise.resolve().then(() => ensureTubmediaOwnedDirectory(sibling, 'merge-checkpoints', explicitRoot))
    ).rejects.toThrow();
  });

  it('rejects a root whose basename is not Tubmedia', async () => {
    await expect(
      Promise.resolve().then(() =>
        ensureTubmediaOwnedDirectory(wrongRootTarget, 'merge-checkpoints', wrongRoot)
      )
    ).rejects.toThrow();
  });

  it('rejects traversal outside the explicit Tubmedia root', async () => {
    await expect(
      Promise.resolve().then(() =>
        ensureTubmediaOwnedDirectory(escapeTarget, 'merge-checkpoints', explicitRoot)
      )
    ).rejects.toThrow();
  });
});
