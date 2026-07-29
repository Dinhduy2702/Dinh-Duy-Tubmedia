import { mkdir, rename, copyFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../logging/logger.js';
export class QuarantineService {
  public constructor(private readonly logger: Logger) {}
  public async move(file: string, folder: string, reason: string, jobId: string): Promise<string> {
    await mkdir(folder, { recursive: true });
    const target = join(folder, `${Date.now()}-${randomUUID().slice(0, 8)}-${basename(file)}`);
    try {
      await rename(file, target);
    } catch {
      await copyFile(file, target);
      await rm(file, { force: true });
    }
    this.logger.warn('quarantine', 'FILE_QUARANTINED', reason, { jobId, metadata: { original: file, target } });
    return target;
  }
}
