import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commitFileWithoutOverwrite,
  nonConflictingPath
} from '../src/main/files/non-conflicting-path.ts';
import {
  formatSelectorForWorkflow,
  formatSortForWorkflow,
  HIGHEST_SOURCE_FORMAT_SELECTOR
} from '../src/shared/utils/download-quality.ts';
import { chooseMergeTarget } from '../src/shared/utils/merge-target.ts';

const folder = await mkdtemp(join(tmpdir(), 'tubmedia-behavior-'));
try {
  const desired = join(folder, 'video.mp4');
  const pending = join(folder, 'video.pending.mp4');
  await writeFile(desired, 'USER');
  await writeFile(pending, 'TUBMEDIA');
  assert.equal(await nonConflictingPath(desired), join(folder, 'video (2).mp4'));
  const committed = await commitFileWithoutOverwrite(pending, desired);
  assert.equal(committed, join(folder, 'video (2).mp4'));
  assert.equal(await readFile(desired, 'utf8'), 'USER');
  assert.equal(await readFile(committed, 'utf8'), 'TUBMEDIA');

  const sourceSettings = {
    downloadCompatibilityMode: 'source',
    downloadMinHeight: 0,
    downloadMaxHeight: 0,
    downloadMinFps: 0,
    downloadMaxFps: 0,
    downloadCodecPreference: 'auto',
    downloadContainerPreference: 'auto',
    downloadMinVideoBitrateKbps: 0,
    downloadVideoBitrateKbps: 0,
    downloadMinAudioBitrateKbps: 0,
    downloadAudioBitrateKbps: 0,
    downloadAllowBelowMinimum: false
  };
  assert.equal(
    formatSelectorForWorkflow(sourceSettings, 'download-only'),
    HIGHEST_SOURCE_FORMAT_SELECTOR
  );
  assert.equal(
    formatSortForWorkflow(sourceSettings, 'download-only'),
    'res,fps,size,tbr,vbr,hdr,vcodec,abr,acodec'
  );
  assert.equal(formatSelectorForWorkflow(sourceSettings, 'download-merge'), 'bv*+ba/b');

  const source = {
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'hevc',
    videoProfile: null,
    videoLevel: null,
    pixelFormat: 'yuv420p10le',
    bitDepth: 10,
    timeBase: '1/90000',
    colorPrimaries: 'bt2020',
    colorTransfer: 'smpte2084',
    colorSpace: 'bt2020nc',
    hdr: true,
    audioCodec: 'aac',
    videoBitrate: 8_000_000,
    audioBitrate: 256_000,
    sampleRate: 48_000,
    channels: 2,
    channelLayout: 'stereo',
    formatName: 'mov,mp4',
    fileSize: 12_000_000
  };
  const profile = {
    mode: 'smart_merge',
    maxWidth: null,
    maxHeight: null,
    allowUpscale: false,
    fpsMode: 'source',
    customFps: null,
    videoCodec: 'copy',
    encoder: 'auto',
    crf: 16,
    cq: 19,
    bitrateMode: 'source_average',
    preset: 'veryfast',
    pixelFormat: 'yuv420p',
    hdrMode: 'auto',
    audioMode: 'copy_if_compatible',
    sampleRate: 48_000,
    forceStereo: false
  };
  const target = chooseMergeTarget([source, { ...source, duration: 20 }], profile);
  assert.equal(target.hdr, true);
  assert.equal(target.videoCodec, 'hevc');

  console.log('PASS: existing output is preserved and pending output uses a non-conflicting path');
  console.log('PASS: source download selector is unbounded highest-source');
  console.log('PASS: merge-source selector is independent from download-only settings');
  console.log('PASS: HDR Auto keeps HDR when every source is HDR');
} finally {
  await rm(folder, { recursive: true, force: true });
}
