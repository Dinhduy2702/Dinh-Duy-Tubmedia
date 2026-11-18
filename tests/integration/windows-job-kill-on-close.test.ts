import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VideoLinkFilterService } from '../../src/main/media/video-link-filter-service.js';
import type { Logger } from '../../src/main/logging/logger.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';

const tempDirs: string[] = [];
const cleanupPids: number[] = [];

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function forceKillPid(pid: number, tree = true): Promise<void> {
  if (!isPidAlive(pid)) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const args = tree ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/F'];
      const killer = spawn('taskkill.exe', args, { windowsHide: true, stdio: 'ignore' });
      killer.once('close', () => resolve());
      killer.once('error', () => resolve());
    });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
}

afterEach(async () => {
  for (const pid of cleanupPids.splice(0)) {
    await forceKillPid(pid, true);
  }
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
} as unknown as Logger;

describe.runIf(process.platform === 'win32')(
  'Việc C — Windows Job Object KILL_ON_JOB_CLOSE & dọn cây tiến trình VideoLinkFilterService',
  () => {
    it(
      'tắt ngang tiến trình chủ (taskkill /F KHÔNG có /T như End Task): con của ProcessManager tắt trong <= 5s, tệp .part còn nguyên, trình cài cập nhật ngoài ProcessManager KHÔNG bị giết',
      async () => {
        const root = await mkdtemp(join(tmpdir(), 'tubmedia-job-kill-on-close-'));
        tempDirs.push(root);

        const innerWorkerScript = join(root, 'fake-ytdlp-inner-python.mjs');
        const workerScript = join(root, 'fake-ytdlp-worker.mjs');
        const updaterScript = join(root, 'fake-nsis-updater.mjs');
        const ownerScript = join(root, 'fake-app-owner.mjs');
        const partFile = join(root, 'video [LINK_AABBCCDDEEFF].mp4.part');
        const stateFile = join(root, 'pids.json');

        await writeFile(innerWorkerScript, 'setInterval(() => {}, 1000);\n', 'utf8');
        await writeFile(
          workerScript,
          `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(partFile)}, 'partial-video-bytes-preserved');
// Mô phỏng yt-dlp.exe (PyInstaller) / yt-dlp gọi ffmpeg-aria2c tách console riêng
const inner = spawn(process.execPath, [${JSON.stringify(innerWorkerScript)}], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true
});
process.stdout.write('WORKER_READY:' + String(inner.pid ?? 0) + '\\n');
setInterval(() => {}, 1000);
`,
          'utf8'
        );

        await writeFile(
          updaterScript,
          `
setInterval(() => {}, 1000);
`,
          'utf8'
        );

        // Chạy tiến trình chủ độc lập qua tsx/vite-node? Dùng node --experimental-strip-types? Không: ProcessManager dùng alias @shared -> chạy qua vitest worker? Không thể kill vitest worker!
        // Tạo gói bundle nhỏ cho owner bằng esbuild (có sẵn trong vite/devDependencies) để chạy bằng node.exe thuần giống hệt tiến trình main đã build!
        const esbuildPath = join(process.cwd(), 'node_modules', 'esbuild', 'lib', 'main.js');
        const ownerEntry = join(root, 'owner-entry.ts');
        const ownerBundle = join(root, 'owner-bundle.mjs');
        await writeFile(
          ownerEntry,
          `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { ProcessManager } from ${JSON.stringify(join(process.cwd(), 'src/main/processes/process-manager.ts'))};

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const pm = new ProcessManager(logger as never);

// Mô phỏng trình cài NSIS cập nhật được gọi trực tiếp ngoài ProcessManager
const updater = spawn(process.execPath, [${JSON.stringify(updaterScript)}], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true
});
updater.unref();

void pm.run({
  jobId: 'dl-job-1',
  tool: 'yt-dlp',
  executablePath: process.execPath,
  args: [${JSON.stringify(workerScript)}],
  onStdoutLine: (line) => {
    if (line.startsWith('WORKER_READY:')) {
      const innerPid = Number(line.slice('WORKER_READY:'.length).trim()) || 0;
      const managedPid = [...(pm as unknown as { active: Map<string, { process: { pid?: number } }> }).active.values()][0]?.process.pid ?? 0;
      writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify({
        ownerPid: process.pid,
        workerPid: managedPid,
        innerPid,
        updaterPid: updater.pid ?? 0
      }));
    }
  }
}).catch(() => {});

setInterval(() => {}, 1000);
`,
          'utf8'
        );

        const { build } = (await import(esbuildPath)) as {
          build: (opts: Record<string, unknown>) => Promise<unknown>;
        };
        await build({
          entryPoints: [ownerEntry],
          bundle: true,
          platform: 'node',
          format: 'esm',
          outfile: ownerBundle,
          alias: {
            '@shared': join(process.cwd(), 'src/shared'),
            '@main': join(process.cwd(), 'src/main')
          }
        });
        void ownerScript;

        // Mô phỏng đúng tiến trình Electron GUI (DETACHED_PROCESS — không có console chung như node.exe CLI, không bật VITEST)
        const owner = spawn(process.execPath, [ownerBundle], {
          detached: true,
          windowsHide: true,
          env: { ...process.env, VITEST: '' },
          stdio: ['ignore', 'pipe', 'pipe']
        });
        if (owner.pid) cleanupPids.push(owner.pid);

        await expect
          .poll(() => existsSync(stateFile), { timeout: 10_000, interval: 50 })
          .toBe(true);

        const { ownerPid, workerPid, innerPid, updaterPid } = JSON.parse(await readFile(stateFile, 'utf8')) as {
          ownerPid: number;
          workerPid: number;
          innerPid: number;
          updaterPid: number;
        };
        cleanupPids.push(workerPid, innerPid, updaterPid);

        expect(isPidAlive(ownerPid)).toBe(true);
        expect(isPidAlive(workerPid)).toBe(true);
        expect(isPidAlive(innerPid)).toBe(true);
        expect(isPidAlive(updaterPid)).toBe(true);

        // Giết NGANG tiến trình chủ bằng TerminateProcess (process.kill — đúng như End Task trong Task Manager hoặc app sập)
        process.kill(ownerPid);

        // Cả tiến trình trực tiếp lẫn tiến trình con bên trong (yt-dlp Python / ffmpeg / aria2c) phải tự tắt trong <= 5 giây nhờ Job Object KILL_ON_JOB_CLOSE
        await expect
          .poll(() => isPidAlive(workerPid) || isPidAlive(innerPid), { timeout: 5_000, interval: 100 })
          .toBe(false);

        // Tệp .part tải dở vẫn còn nguyên vẹn để mở lại app tải tiếp
        expect(existsSync(partFile)).toBe(true);
        expect(await readFile(partFile, 'utf8')).toBe('partial-video-bytes-preserved');

        // Trình cài cập nhật chạy ngoài ProcessManager KHÔNG bị Job Object giết theo
        expect(isPidAlive(updaterPid)).toBe(true);
      },
      45_000
    );

    it(
      'VideoLinkFilterService khi cắt ngang do tràn dữ liệu hoặc quá giờ phải diệt cả cây tiến trình con (không để sót con kiểu PyInstaller)',
      async () => {
        const root = await mkdtemp(join(tmpdir(), 'tubmedia-vlf-tree-kill-'));
        tempDirs.push(root);

        const grandchildPidFile = join(root, 'grandchild.pid');
        const grandchildScript = join(root, 'grandchild.mjs');
        const fakeBootloaderScript = join(root, 'fake-ytdlp-bootloader.mjs');

        await writeFile(grandchildScript, 'setInterval(() => {}, 1000);\n', 'utf8');
        await writeFile(
          fakeBootloaderScript,
          `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const gc = spawn(process.execPath, [${JSON.stringify(grandchildScript)}], { detached: true, stdio: 'ignore', windowsHide: true });
writeFileSync(${JSON.stringify(grandchildPidFile)}, String(gc.pid ?? 0));
// Đổ vượt ngưỡng MAX_YTDLP_OUTPUT_BYTES (64 MiB) để kích hoạt nhánh dừng khẩn cấp
const bigChunk = 'X'.repeat(4 * 1024 * 1024) + '\\n';
const pump = setInterval(() => {
  process.stdout.write(bigChunk);
}, 10);
gc.on('exit', () => clearInterval(pump));
`,
          'utf8'
        );

        const tools = {
          ensureRequiredReady: () => Promise.resolve([]),
          get: () => ({
            name: 'yt-dlp',
            available: true,
            executablePath: process.execPath,
            health: 'healthy'
          })
        } as unknown as ToolManager;

        const service = new VideoLinkFilterService(tools, silentLogger);
        const runYtDlp = (
          service as unknown as {
            runYtDlp: (exe: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
          }
        ).runYtDlp.bind(service);

        await expect(runYtDlp(process.execPath, [fakeBootloaderScript])).rejects.toThrow(/quá nhiều dữ liệu/);

        const grandchildPid = Number((await readFile(grandchildPidFile, 'utf8')).trim());
        cleanupPids.push(grandchildPid);
        expect(grandchildPid).toBeGreaterThan(0);

        await expect
          .poll(() => isPidAlive(grandchildPid), { timeout: 5_000, interval: 100 })
          .toBe(false);
      },
      45_000
    );
  }
);
