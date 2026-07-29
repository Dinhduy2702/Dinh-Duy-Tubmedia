import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClipEngine } from '../../src/main/clips/clip-engine.js';
import type { FileVerifier } from '../../src/main/media/file-verifier.js';
import type { ProcessManager, ProcessRunOptions } from '../../src/main/processes/process-manager.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import type { ProjectItem, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

const resource = { ffmpegThreads: 4, filterThreads: 2, processPriority: 'below_normal' } as ResourceProfile;
const job = { id: 'job', projectId: 'project' } as QueueJob;
const item = {
  id: 'item', position: 1, timestampStartSeconds: null, timestampEndSeconds: null, audioMode: 'mute'
} as ProjectItem;

describe('ClipEngine mute-only path', () => {
  it('copies the video stream and preserves the source container', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-clip-'));
    folders.push(folder);
    const input = join(folder, 'source.webm');
    await writeFile(input, 'source');
    let args: string[] = [];
    const processes = { run: async (options: ProcessRunOptions) => {
      args = options.args;
      await writeFile(options.args.at(-1)!, 'pending');
      return { code: 0, stdoutTail: '', stderrTail: '', durationMs: 1 };
    }} as unknown as ProcessManager;
    const verifier = { verify: (path: string) => Promise.resolve({ ok: true, path, level: 'standard', reasons: [], duration: 1 }) } as unknown as FileVerifier;
    const engine = new ClipEngine(
      { get: () => ({ available: true, executablePath: 'ffmpeg' }) } as unknown as ToolManager,
      processes,
      verifier,
      {} as QuarantineService
    );

    const output = await engine.create(job, item, input, folder, resource, new AbortController().signal, () => undefined);
    expect(output.endsWith('.webm')).toBe(true);
    expect(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2)).toEqual(['-c:v', 'copy']);
    expect(args).toContain('-an');
    expect(args).not.toContain('libx264');
  });
});
