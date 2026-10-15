import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { FileVerifier } from '../../../src/main/media/file-verifier.js';
import { MediaAnalyzer } from '../../../src/main/media/media-analyzer.js';
import { ProcessManager } from '../../../src/main/processes/process-manager.js';
import type { ToolManager } from '../../../src/main/tools/tool-manager.js';
import type { Logger } from '../../../src/main/logging/logger.js';

/**
 * ffmpeg/ffprobe THẬT cho bài integration về giải mã: bản đi kèm app đã cài, hoặc ffmpeg trên PATH qua winget.
 * Không có thì bài tự bỏ qua (máy CI không có công cụ).
 */
export function resolveRealFfmpegDirectory(): string | null {
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Download video Tubmedia', 'resources', 'tool'),
    join(process.cwd(), 'tool')
  ];
  for (const directory of candidates) {
    if (existsSync(join(directory, 'ffmpeg.exe')) && existsSync(join(directory, 'ffprobe.exe'))) return directory;
  }
  return null;
}

export const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
} as unknown as Logger;

export interface RealMediaStack {
  tools: ToolManager;
  processes: ProcessManager;
  analyzer: MediaAnalyzer;
  verifier: FileVerifier;
}

export function realMediaStack(directory: string): RealMediaStack {
  const tools = {
    get: (name: string) => ({
      name,
      available: true,
      executablePath: join(directory, name + '.exe'),
      capabilities: ['libx264', 'aac']
    })
  } as unknown as ToolManager;
  const processes = new ProcessManager(silentLogger);
  const analyzer = new MediaAnalyzer(processes, tools);
  const verifier = new FileVerifier(analyzer, processes, tools);
  return { tools, processes, analyzer, verifier };
}

/** Clip thử: testsrc + tiếng sine, h264 + AAC. */
export function makeClip(
  directory: string,
  output: string,
  options: { width: number; height: number; fps: number; seconds: number; sampleRate: number }
): void {
  const result = spawnSync(
    join(directory, 'ffmpeg.exe'),
    [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=${options.width}x${options.height}:rate=${options.fps}:duration=${options.seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${options.seconds}:sample_rate=${options.sampleRate}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '256k',
      output
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 120_000 }
  );
  if (result.status !== 0) throw new Error('Không dựng được clip thử: ' + result.stderr);
}

/**
 * Ghi đè dữ liệu của 40 gói AAC ở giữa tệp bằng byte giả ngẫu nhiên (cố định hạt giống) — tái hiện thành phẩm của khách
 * (2026-10-15): luồng hình giải mã sạch, luồng tiếng báo "aac … Invalid data found when processing input".
 */
export function corruptMiddleAudioPackets(directory: string, file: string): void {
  const probe = spawnSync(
    join(directory, 'ffprobe.exe'),
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=pos,size', '-of', 'csv=p=0', file],
    { encoding: 'utf8', windowsHide: true }
  );
  const packets = probe.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map(Number))
    .map(([size, pos]) => ({ size: size ?? 0, pos: pos ?? 0 }))
    .filter((packet) => packet.size > 0 && packet.pos > 0);
  if (packets.length < 60) throw new Error('Clip thử quá ít gói tiếng: ' + packets.length);
  const middle = Math.floor(packets.length / 2);
  const fd = openSync(file, 'r+');
  let seed = 7;
  try {
    for (const packet of packets.slice(middle, middle + 40)) {
      const buffer = Buffer.alloc(packet.size);
      for (let index = 0; index < buffer.length; index += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        buffer[index] = seed & 0xff;
      }
      writeSync(fd, buffer, 0, buffer.length, packet.pos);
    }
  } finally {
    closeSync(fd);
  }
}

/** Mã thoát khi giải mã nghiêm ngặt đúng một luồng — để bài kiểm tự xác nhận tệp mẫu hỏng đúng chỗ. */
export function strictDecodeStatus(directory: string, file: string, map: string): number | null {
  return spawnSync(
    join(directory, 'ffmpeg.exe'),
    ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', file, '-map', map, '-f', 'null', '-'],
    { encoding: 'utf8', windowsHide: true, timeout: 120_000 }
  ).status;
}
