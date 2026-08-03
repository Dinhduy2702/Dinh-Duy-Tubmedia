import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpdir())
  },
  shell: {
    showItemInFolder: vi.fn()
  }
}));

import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';
import type { QuickDownloadStatus } from '../../src/shared/quick-download.js';

const temporaryRoots: string[] = [];

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-quick-service-'));
  temporaryRoots.push(root);
  const outputDirectory = join(root, 'output');
  const stateDirectory = join(root, 'state');
  await mkdir(outputDirectory, { recursive: true });

  const processState = { active: false };
  const processes = {
    run: vi.fn(async (options: {
      signal?: AbortSignal;
      onStdoutLine?: (line: string) => void;
    }) => {
      processState.active = true;
      return await new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => {
            processState.active = false;
            reject(new Error('aborted'));
          },
          { once: true }
        );
      });
    }),
    hasJob: vi.fn(() => processState.active),
    pauseByJob: vi.fn(() => Promise.resolve()),
    resumeByJob: vi.fn(() => Promise.resolve()),
    killByJob: vi.fn(() => {
      processState.active = false;
      return Promise.resolve();
    })
  };
  const tools = {
    ensureRequiredReady: vi.fn(() => Promise.resolve([])),
    get: vi.fn((name: string) => ({
      name,
      available: true,
      executablePath: join(root, `${name}.exe`)
    }))
  };
  const verifier = {
    verify: vi.fn(() =>
      Promise.resolve({
        ok: true,
        reasons: [],
        duration: 300
      })
    )
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  const service = new QuickDownloadService(
    processes as never,
    tools as never,
    verifier as never,
    logger as never,
    stateDirectory
  );

  return {
    root,
    outputDirectory,
    stateDirectory,
    processes,
    service
  };
}

function request(outputDirectory: string) {
  return {
    url: 'https://example.com/video',
    outputDirectory,
    quality: 'best' as const,
    mode: 'range' as const,
    startTime: '25:10:30',
    endTime: '25:15:30',
    accurateCut: false
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
});

describe('QuickDownloadService lifecycle', () => {
  it('serializes simultaneous start calls and allows only one active task', async () => {
    const fixture = await createFixture();
    const first = fixture.service.start(request(fixture.outputDirectory));
    const second = fixture.service.start(request(fixture.outputDirectory));
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);

    expect(firstResult.status).toBe('fulfilled');
    expect(secondResult.status).toBe('rejected');

    if (firstResult.status === 'fulfilled') {
      await fixture.service.cancel(firstResult.value.taskId);
      expect(fixture.service.status(firstResult.value.taskId)?.phase).toBe('cancelled');
    }
  });

  it('routes pause, resume and cancel through ProcessManager', async () => {
    const fixture = await createFixture();
    const started = await fixture.service.start(request(fixture.outputDirectory));

    await fixture.service.pause(started.taskId);
    expect(fixture.processes.pauseByJob).toHaveBeenCalledWith(started.taskId);
    expect(fixture.service.status(started.taskId)?.phase).toBe('paused');

    await fixture.service.resume(started.taskId);
    expect(fixture.processes.resumeByJob).toHaveBeenCalledWith(started.taskId);

    await fixture.service.cancel(started.taskId);
    expect(fixture.processes.killByJob).toHaveBeenCalledWith(started.taskId);
    expect(fixture.service.status(started.taskId)?.phase).toBe('cancelled');
  });

  it('recovers non-terminal persisted tasks as interrupted', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.stateDirectory, { recursive: true });

    const persisted = {
      taskId: '12345678-1234-4234-8234-123456789abc',
      mode: 'full',
      phase: 'downloading',
      progress: 42,
      title: 'Video đang tải',
      message: 'Đang tải',
      speed: '',
      eta: '',
      downloadedBytes: 1,
      totalBytes: 2,
      outputPath: null,
      outputDirectory: fixture.outputDirectory,
      requestedStartSeconds: null,
      requestedEndSeconds: null,
      actualDurationSeconds: null,
      accurateCut: false,
      startedAt: new Date(0).toISOString(),
      completedAt: null,
      error: null,
      warnings: []
    } as unknown as QuickDownloadStatus;

    await writeFile(
      join(fixture.stateDirectory, 'state.json'),
      JSON.stringify({ version: 1, statuses: [persisted] }),
      'utf8'
    );

    await fixture.service.recover();
    const recovered = fixture.service.status(persisted.taskId);

    expect(recovered?.phase).toBe('interrupted');
    expect(recovered?.completedAt).not.toBeNull();
    expect(recovered?.mediaMode).toBe('video-audio');

    const state = JSON.parse(
      await readFile(join(fixture.stateDirectory, 'state.json'), 'utf8')
    ) as { statuses: QuickDownloadStatus[] };
    expect(state.statuses[0]?.phase).toBe('interrupted');
  });
});
