import { cpus, freemem, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import type { SystemStats } from '@shared/types/domain.js';
import type { QueueManager } from '../queue/queue-manager.js';
import type { ProcessManager } from '../processes/process-manager.js';
export class SystemStatsService {
  private previous = cpus();
  public constructor(private readonly queue: QueueManager, private readonly processes: ProcessManager, private readonly mounts: () => string[]) {}
  private cpuPercent(): number {
    const current = cpus(); let idle = 0; let total = 0;
    const sumTimes = (times: { user:number; nice:number; sys:number; idle:number; irq:number }): number => times.user + times.nice + times.sys + times.idle + times.irq;
    current.forEach((cpu, i) => { const before = this.previous[i] ?? cpu; const nowTotal = sumTimes(cpu.times); const beforeTotal = sumTimes(before.times); total += nowTotal - beforeTotal; idle += cpu.times.idle - before.times.idle; });
    this.previous = current; return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
  }
  public async sample(): Promise<SystemStats> {
    const total = totalmem(); const used = total - freemem(); const disks: SystemStats['disks'] = [];
    for (const mount of [...new Set(this.mounts())]) { try { const fs = await statfs(mount); const totalBytes = Number(fs.blocks) * Number(fs.bsize); const freeBytes = Number(fs.bavail) * Number(fs.bsize); disks.push({ mount, freeBytes, totalBytes, usedPercent: totalBytes ? (1 - freeBytes / totalBytes) * 100 : 0 }); } catch { /* ổ không tồn tại */ } }
    return { cpuPercent: this.cpuPercent(), memoryUsedBytes: used, memoryTotalBytes: total, memoryPercent: used / total * 100, disks, activeProcesses: this.processes.count(), activeJobs: this.queue.activeCount(), downloadSpeedBytes: 0, encodeFps: 0, sampledAt: new Date().toISOString() };
  }
}
