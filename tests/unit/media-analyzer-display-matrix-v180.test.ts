import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import { matchNormalizationTarget } from '../../src/shared/utils/normalization-match.js';
import { compareForConcat } from '../../src/shared/utils/concat-compatibility.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

function makeAnalyzer(probe: Record<string, unknown>): MediaAnalyzer {
  return new MediaAnalyzer(
    {
      run: () => Promise.resolve({ code: 0, stdoutTail: JSON.stringify(probe), stderrTail: '', durationMs: 1 })
    } as unknown as ProcessManager,
    { get: () => ({ available: true, executablePath: 'ffprobe' }) } as unknown as ToolManager
  );
}

describe('Lỗi #42: nhận diện cờ flip Display Matrix và sửa DAR sau xoay', () => {
  it('đảo DAR (và SAR khác 1:1) khi video xoay 90 hoặc 270 độ', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-42-dar-'));
    folders.push(folder);
    const file = join(folder, 'rotated.mp4');
    await writeFile(file, 'fixture');

    const analyzer = makeAnalyzer({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30/1',
          r_frame_rate: '30/1',
          pix_fmt: 'yuv420p',
          duration: '10',
          time_base: '1/90000',
          sample_aspect_ratio: '4:3',
          display_aspect_ratio: '16:9',
          side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }]
        }
      ],
      format: { duration: '10', bit_rate: '5000000' }
    });

    const info = await analyzer.analyze(file);
    expect(info.rotation).toBe(270);
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(info.displayAspectRatio).toBe('9:16');
    expect(info.sampleAspectRatio).toBe('3:4');
  });

  it('nhận diện cờ flip từ Display Matrix (det < 0 hoặc hflip/vflip) và chặn stream-copy/concat-copy', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tubmedia-42-flip-'));
    folders.push(folder);
    const file = join(folder, 'flipped.mp4');
    await writeFile(file, 'fixture');

    // Ma trận phản chiếu ngang: row0 = [-65536, 0, 0], row1 = [0, 65536, 0] -> det < 0 dù rotation = 0
    const displaymatrix = [
      '00000000:      -65536           0           0',
      '00000001:           0       65536           0',
      '00000002:           0           0  1073741824'
    ].join('\n');

    const analyzer = makeAnalyzer({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30/1',
          r_frame_rate: '30/1',
          pix_fmt: 'yuv420p',
          duration: '10',
          time_base: '1/90000',
          sample_aspect_ratio: '1:1',
          display_aspect_ratio: '16:9',
          side_data_list: [{ side_data_type: 'Display Matrix', displaymatrix, rotation: 0 }]
        }
      ],
      format: { duration: '10', bit_rate: '5000000' }
    });

    const flippedInfo = await analyzer.analyze(file);
    expect(flippedInfo.displayFlip).toBe(true);

    const match = matchNormalizationTarget(flippedInfo, {
      width: 1920,
      height: 1080,
      fps: 30,
      hdr: false,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioCodec: null,
      sampleRate: null,
      channels: null
    });
    expect(match.videoMatches).toBe(false);

    const normalInfo = { ...flippedInfo, displayFlip: false };
    expect(compareForConcat(normalInfo, flippedInfo).compatible).toBe(false);
  });
});
