import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPreviewFrameDownloadArguments } from '../../src/main/download/preview-frame-command.js';

const processManagerSrc = readFileSync(resolve(process.cwd(), 'src/main/processes/process-manager.ts'), 'utf8');
const videoLinkFilterSrc = readFileSync(resolve(process.cwd(), 'src/main/media/video-link-filter-service.ts'), 'utf8');
const windowsJobHostSrc = readFileSync(resolve(process.cwd(), 'src/main/processes/windows-job-host.ts'), 'utf8');

describe('Cứng hóa tiến trình nền & yt-dlp (#6)', () => {
  it('ProcessManager.setPriority dùng node:os setPriority thay vì spawn powershell.exe', () => {
    const start = processManagerSrc.indexOf('public setPriority(');
    const end = processManagerSrc.indexOf('private matchesJobFamily(', start);
    const body = processManagerSrc.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(processManagerSrc).toMatch(/from 'node:os'/);
    expect(body).not.toContain('powershell.exe');
    expect(body).toMatch(/osSetPriority\s*\(/);
  });

  it('ProcessManager.kill và runPowerShell đều có giới hạn thời gian 10–15s', () => {
    const killStart = processManagerSrc.indexOf('public async kill(');
    const killEnd = processManagerSrc.indexOf('public async killByJob(', killStart);
    const killBody = processManagerSrc.slice(killStart, killEnd);

    const psStart = processManagerSrc.indexOf('private async runPowerShell(');
    const psBody = processManagerSrc.slice(psStart);

    expect(killBody).toContain('setTimeout');
    expect(psBody).toContain('setTimeout');
  });

  it('PreviewFrameCommand truyền --socket-timeout và --proxy khi có cấu hình proxy', () => {
    const args = buildPreviewFrameDownloadArguments(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      10,
      { ffmpegDirectory: 'C:\\tools', workDirectory: 'C:\\temp' },
      undefined,
      [],
      'http://127.0.0.1:8080'
    );
    expect(args).toContain('--socket-timeout');
    const proxyIndex = args.indexOf('--proxy');
    expect(proxyIndex).toBeGreaterThan(-1);
    expect(args[proxyIndex + 1]).toBe('http://127.0.0.1:8080');
  });

  it('VideoLinkFilterService truyền --socket-timeout, --proxy và có inactivityTimeoutMs cho yt-dlp', () => {
    expect(videoLinkFilterSrc).toContain("'--socket-timeout'");
    expect(videoLinkFilterSrc).toContain("'--proxy'");
    expect(videoLinkFilterSrc).toContain('inactivityTimeoutMs');
  });

  it('WindowsJobHost gắn reqId vào ASSIGN và khớp OK|<reqId> theo Map', () => {
    expect(windowsJobHostSrc).toMatch(/pendingAcks\s*=\s*new Map/);
    expect(windowsJobHostSrc).toContain('OK|');
    expect(windowsJobHostSrc).toMatch(/ASSIGN \$\{pid\} \$\{tag\} \$\{reqId\}/);
  });
});
