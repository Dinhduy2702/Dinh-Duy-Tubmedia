import { access, open, rm, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PermissionDeniedError } from '@shared/errors/app-errors.js';
import { ensureDirectory } from '../files/ensure-directory.js';

export interface PathCheck { path: string; writable: boolean; freeBytes: number; totalBytes: number; warnings: string[]; }
export class PathService {
  public normalize(input: string): string { return normalize(resolve(input)); }
  public async ensureWritable(input: string): Promise<PathCheck> {
    const path = this.normalize(input);
    await ensureDirectory(path);
    try { await access(path, constants.R_OK | constants.W_OK); } catch { throw new PermissionDeniedError(path); }
    const test = resolve(path, `.vdmsp-write-test-${randomUUID()}.tmp`);
    const handle = await open(test, 'wx');
    await handle.writeFile('ok');
    await handle.close();
    await rm(test, { force: true });
    const fs = await statfs(path);
    const freeBytes = Number(fs.bavail) * Number(fs.bsize);
    const totalBytes = Number(fs.blocks) * Number(fs.bsize);
    const warnings: string[] = [];
    if (freeBytes < 15 * 1024 ** 3) warnings.push('Ổ đĩa còn dưới 15 GB.');
    return { path, writable: true, freeBytes, totalBytes, warnings };
  }
  public parent(input: string): string { return dirname(this.normalize(input)); }
}
