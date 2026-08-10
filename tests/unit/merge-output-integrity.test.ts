import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { compareForConcat } from '@shared/utils/concat-compatibility.js';
import type { MediaInfo } from '@shared/types/domain.js';
import { isVisualIssueNearBoundary } from '../../src/main/media/file-verifier.js';

const info: MediaInfo = {
  duration: 60,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoProfile: 'High',
  videoLevel: '4.1',
  pixelFormat: 'yuv420p',
  bitDepth: 8,
  timeBase: '1/30000',
  nominalFps: 30,
  variableFrameRate: false,
  sampleAspectRatio: '1:1',
  displayAspectRatio: '16:9',
  rotation: 0,
  streamStartTime: 0,
  timestampCondition: 'normal',
  colorPrimaries: 'bt709',
  colorTransfer: 'bt709',
  colorSpace: 'bt709',
  colorRange: 'tv',
  hdr: false,
  hdrType: null,
  masteringDisplayMetadata: false,
  audioCodec: 'aac',
  videoBitrate: 6_000_000,
  audioBitrate: 192_000,
  sampleRate: 48_000,
  channels: 2,
  channelLayout: 'stereo',
  formatName: 'mp4',
  fileSize: 1_000_000
};

describe('merge output integrity hardening', () => {
  it('blocks decoder-critical stream-copy mismatches', () => {
    expect(compareForConcat(info, { ...info, videoProfile: 'Main' }).compatible).toBe(false);
    expect(compareForConcat(info, { ...info, videoLevel: '4.2' }).compatible).toBe(false);
    expect(compareForConcat(info, { ...info, colorTransfer: 'smpte2084' }).compatible).toBe(false);
  });

  it('recognizes a visual anomaly at a concat boundary', () => {
    expect(isVisualIssueNearBoundary({ startSeconds: 2159.2, endSeconds: 2161.1 }, [2160])).toBe(true);
    expect(isVisualIssueNearBoundary({ startSeconds: 2100, endSeconds: 2101 }, [2160])).toBe(false);
  });

  it('keeps the mandatory full-frame gate before final commit', async () => {
    const [merge, verifier, normalize] = await Promise.all([
      readFile(new URL('../../src/main/merge/merge-engine.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/media/file-verifier.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/main/normalize/normalize-engine.ts', import.meta.url), 'utf8')
    ]);
    expect(merge).toContain('verifyVisualIntegrity');
    expect(merge).toContain("phase: 'visual-integrity-verification'");
    expect(merge.indexOf('verifyVisualIntegrity')).toBeLessThan(merge.indexOf('commitFileWithoutOverwrite(pending, final)'));
    expect(verifier).toContain("'-xerror'");
    expect(verifier).toContain("'blackdetect=d=0.08:pix_th=0.02,freezedetect=n=-60dB:d=1'");
    expect(normalize).toContain('forceVideoTranscode = false');
  });
});
