import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

describe('MediaAnalyzer color and display metadata', () => {
  it('does not classify 10-bit BT.709 SDR as HDR and applies rotation to display size', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-probe-'));
    folders.push(folder);
    const path = join(folder, 'source.mp4');
    await writeFile(path, 'fixture');
    const probe = {
      streams: [{
        codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080,
        avg_frame_rate: '30000/1001', r_frame_rate: '60/1', pix_fmt: 'yuv420p10le',
        color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709',
        duration: '10', time_base: '1/90000', tags: { rotate: '90' },
        sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9'
      }],
      format: { duration: '10', bit_rate: '10000000' }
    };
    const analyzer = new MediaAnalyzer(
      { run: () => Promise.resolve({ code: 0, stdoutTail: JSON.stringify(probe), stderrTail: '', durationMs: 1 }) } as unknown as ProcessManager,
      { get: () => ({ available: true, executablePath: 'ffprobe' }) } as unknown as ToolManager
    );
    const info = await analyzer.analyze(path);
    expect(info.hdr).toBe(false);
    expect(info.hdrType).toBeNull();
    expect(info.rotation).toBe(90);
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(info.variableFrameRate).toBe(true);
  });
});
