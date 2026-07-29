import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HardwareService } from '../../src/main/settings/hardware-service.js';

async function readProjectFile(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), 'utf8');
}

describe('khởi động giao diện nhanh', () => {
  it('creates a hardware snapshot without waiting for PowerShell or CIM', () => {
    const snapshot = new HardwareService().quickSnapshot();

    expect(snapshot.logicalCpuCount).toBeGreaterThan(0);
    expect(snapshot.totalMemoryBytes).toBeGreaterThan(0);
    expect(snapshot.detectedAt).toBeTruthy();
  });

  it('bootstrap does not wait for tool repair or full hardware discovery', async () => {
    const ipc = await readProjectFile('src/main/ipc/register-ipc.ts');

    expect(ipc).not.toContain('waitForStartupTools');
    expect(ipc).toContain('hardware: ctx.settings.quickHardware()');
  });

  it('opens the workspace before loading historical logs', async () => {
    const store = await readProjectFile('src/renderer/src/stores/app-store.ts');
    const readyIndex = store.indexOf('ready: true');
    const logLoadIndex = store.search(/window\.desktop\.logs\s*\.list\(\{\s*limit:\s*100\s*\}\)/);

    expect(readyIndex).toBeGreaterThan(-1);
    expect(logLoadIndex).toBeGreaterThan(readyIndex);
    expect(store.search(/window\.desktop\.settings\s*\.hardware\(\)/)).toBeGreaterThan(readyIndex);
  });

  it('checks and repairs required tools before checking optional tools', async () => {
    const [main, manager] = await Promise.all([
      readProjectFile('src/main/index.ts'),
      readProjectFile('src/main/tools/tool-manager.ts')
    ]);

    const requiredIndex = main.indexOf('current.tools.ensureRequiredReady()');
    const optionalIndex = main.indexOf('current.tools.healthCheckOptional()');

    expect(requiredIndex).toBeGreaterThan(-1);
    expect(optionalIndex).toBeGreaterThan(requiredIndex);
    expect(manager).toContain('let statuses = await this.healthCheckRequired()');
    expect(manager).toContain('statuses = await this.healthCheckRequired()');
  });
});
