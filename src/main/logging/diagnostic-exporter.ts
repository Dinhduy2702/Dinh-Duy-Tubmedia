import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactSecretText } from '@shared/utils/secret-redaction.js';

export async function exportSanitizedLogTree(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  let entries: Dirent[];
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await exportSanitizedLogTree(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    const text = await readFile(from, 'utf8');
    await writeFile(to, redactSecretText(text), { encoding: 'utf8', flag: 'wx' });
  }
}
