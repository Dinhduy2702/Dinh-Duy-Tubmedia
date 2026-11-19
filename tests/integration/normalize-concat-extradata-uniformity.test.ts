import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NormalizeEngine, type NormalizeTarget } from '../../src/main/normalize/normalize-engine.js';
import { FileVerifier } from '../../src/main/media/file-verifier.js';
import { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { QuarantineService } from '../../src/main/media/quarantine-service.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';
import { compareForConcat } from '../../src/shared/utils/concat-compatibility.js';
import type { QualityProfile, QueueJob, ResourceProfile } from '../../src/shared/types/domain.js';
import { resolveRealFfmpegDirectory, silentLogger, strictDecodeStatus } from './helpers/real-ffmpeg.js';

/**
 * Tái hiện lỗi ghép thật của khách ngày 2026-11-19 (quy trình Duy_MaxFarmUs_25.11.26):
 * 8 video trộn H.264 + H.265 chuẩn hóa sang H.265 thất bại ở 65% với lỗi:
 *   "Các file vẫn chưa tương thích concat: Video 2: Video extradata: SHA256:... ≠ SHA256:..."
 * do NormalizeEngine chưa đồng nhất chroma_sample_location, dải màu pc/tv (yuvj420p),
 * nhãn màu thiếu trên FFmpeg 8.1, VFR sát FPS mục tiêu và chuỗi x265 info phụ thuộc số luồng CPU.
 */
const toolsDirectory = resolveRealFfmpegDirectory();
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

function runFfmpegFixture(directory: string, args: string[], output: string): string {
  const res = spawnSync(
    join(directory, 'ffmpeg.exe'),
    ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args, output],
    { encoding: 'utf8', windowsHide: true, timeout: 120_000 }
  );
  if (res.status !== 0) {
    throw new Error(`Không tạo được clip mẫu ${output}: ${res.stderr}`);
  }
  return output;
}

function createStack(directory: string): {
  engine: NormalizeEngine;
  analyzer: MediaAnalyzer;
} {
  const tools = {
    get: (name: string) => ({
      name,
      available: true,
      version: 'n8.1.3',
      executablePath: join(directory, `${name}.exe`),
      capabilities: ['libx264', 'libx265', 'aac', 'zscale', 'tonemap']
    })
  } as unknown as ToolManager;
  const processes = new ProcessManager(silentLogger);
  const analyzer = new MediaAnalyzer(processes, tools);
  const verifier = new FileVerifier(analyzer, processes, tools);
  const quarantine = {
    move: (path: string) => Promise.resolve(path)
  } as unknown as QuarantineService;
  const engine = new NormalizeEngine(tools, processes, analyzer, verifier, quarantine, silentLogger);
  return { engine, analyzer };
}

function makeJob(id: string): QueueJob {
  return {
    id,
    projectId: 'project-extradata-uniformity',
    type: 'merge',
    status: 'merging',
    priority: 0,
    sourceId: null,
    itemId: null,
    input: {},
    progress: 0,
    speed: null,
    etaSeconds: null,
    attempts: 0,
    maxAttempts: 1,
    errorCode: null,
    errorMessage: null,
    createdAt: '',
    updatedAt: '',
    startedAt: null,
    finishedAt: null
  };
}

function makeResource(ffmpegThreads: number): ResourceProfile {
  return {
    id: `resource-${ffmpegThreads}`,
    name: `Resource ${ffmpegThreads}`,
    description: '',
    downloadWorkers: 1,
    analyzeWorkers: 1,
    normalizeWorkers: 1,
    remuxWorkers: 1,
    clipWorkers: 1,
    ffmpegThreads,
    filterThreads: Math.max(1, Math.min(2, ffmpegThreads)),
    filterComplexThreads: Math.max(1, Math.min(2, ffmpegThreads)),
    processPriority: 'below_normal',
    cpuSoftLimitPercent: 85,
    memoryFreeMinimumBytes: 1,
    diskFreeMinimumBytes: 1,
    gpuJobs: 0,
    builtIn: true
  };
}

const keepSourceSizeProfile: QualityProfile = {
  id: 'quality-source-size',
  name: 'Nguồn nguyên bản · ghép nhanh thông minh',
  description: '',
  mode: 'smart_merge',
  maxWidth: null,
  maxHeight: null,
  allowUpscale: false,
  fpsMode: 'source',
  customFps: null,
  videoCodec: 'copy',
  encoder: 'auto',
  crf: 20,
  cq: 20,
  bitrateMode: 'source_average',
  preset: 'ultrafast',
  pixelFormat: 'yuv420p',
  hdrMode: 'auto',
  audioMode: 'copy_if_compatible',
  sampleRate: 48000,
  forceStereo: false,
  builtIn: true
};

describe.skipIf(!toolsDirectory)(
  'Đồng nhất extradata và metadata luồng hình sau chuẩn hóa (ffmpeg thật)',
  () => {
    it(
      'chuẩn hóa sang H.265 và H.264 từ nguồn lệch chromaloc (left vs unspecified), lệch dải màu pc (yuvj420p), nguồn VFR và đổi số luồng CPU (2 ↔ 8) đều qua compareForConcat 100%',
      async () => {
        const folder = await mkdtemp(join(tmpdir(), 'tubmedia-extradata-uniform-'));
        folders.push(folder);
        const { engine, analyzer } = createStack(toolsDirectory!);
        const signal = new AbortController().signal;

        // 1. Nguồn H.265 có chroma_sample_location=left + đầy đủ nhãn bt709 (tương ứng NA431_TA.mp4)
        const srcLeft = runFfmpegFixture(
          toolsDirectory!,
          [
            '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
            '-vf', 'scale=in_range=tv:out_range=tv:out_color_matrix=bt709:out_chroma_loc=left,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
            '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'chromaloc=1',
            '-chroma_sample_location', 'left',
            '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-threads', '2'
          ],
          join(folder, '01-hevc-left.mp4')
        );

        // 2. Nguồn H.265 độ phân giải lớn hơn (960x540), chromaloc=0 (unspecified) và thiếu color_primaries/color_trc (tương ứng Y407 TA.mp4)
        const srcUnspecified = runFfmpegFixture(
          toolsDirectory!,
          [
            '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=30:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=44100:duration=2',
            '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'chromaloc=0',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
            '-threads', '2'
          ],
          join(folder, '02-hevc-unspecified-960p.mp4')
        );

        // 3. Nguồn H.264 dải màu đầy đủ pc (yuvj420p) + chromaloc=center + âm thanh mono
        const srcPcFullRange = runFfmpegFixture(
          toolsDirectory!,
          [
            '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=2',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuvj420p',
            '-chroma_sample_location', 'center', '-color_range', 'pc',
            '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '1',
            '-threads', '2'
          ],
          join(folder, '03-h264-pc-yuvj420p.mp4')
        );

        // 4. Nguồn VFR có FPS trung bình đúng bằng 30 (60 khung hình / 2 giây: 0,5s đầu 60fps + 1,5s sau 20fps) nhưng r_frame_rate = 60/1
        const srcVfrNear30 = runFfmpegFixture(
          toolsDirectory!,
          [
            '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=60:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=770:sample_rate=48000:duration=2',
            '-vf', "select='lt(t\\,0.5)+gte(t\\,0.5)*not(mod(n\\,3))'",
            '-fps_mode', 'passthrough',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
            '-video_track_timescale', '90000',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-threads', '2'
          ],
          join(folder, '04-h264-vfr-avg30.mp4')
        );

        // 5. Nguồn H.265 thứ 5 được chuẩn hóa ở mức 8 luồng CPU (mô phỏng tái dùng cache tạo lúc máy 2 luồng ghép chung với tệp mới 8 luồng)
        const srcThreads8 = runFfmpegFixture(
          toolsDirectory!,
          [
            '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2',
            '-vf', 'scale=in_range=tv:out_range=tv:out_color_matrix=bt709:out_chroma_loc=left,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
            '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'chromaloc=1',
            '-chroma_sample_location', 'left',
            '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-threads', '2'
          ],
          join(folder, '05-hevc-threads8.mp4')
        );

        const rawInputs = [
          { path: srcLeft, threads: 2 },
          { path: srcUnspecified, threads: 2 },
          { path: srcPcFullRange, threads: 2 },
          { path: srcVfrNear30, threads: 2 },
          { path: srcThreads8, threads: 8 }
        ];
        const sourceInfos = await Promise.all(
          rawInputs.map((item, idx) => analyzer.analyze(item.path, `probe-src-${idx + 1}`))
        );
        expect(sourceInfos[3]!.variableFrameRate, 'mẫu #4 phải là nguồn VFR thật').toBe(true);

        for (const videoCodec of ['hevc', 'h264'] as const) {
          const cacheDir = join(folder, `_cache-${videoCodec}`);
          const target: NormalizeTarget = {
            width: 640,
            height: 360,
            fps: 30,
            hdr: false,
            videoCodec,
            pixelFormat: 'yuv420p',
            audioCodec: 'aac',
            sampleRate: 48000,
            channels: 2,
            videoBitrate: 2_200_000
          };

          const normalizedPaths: string[] = [];
          for (let i = 0; i < rawInputs.length; i += 1) {
            const out = await engine.normalizeToTarget(
              makeJob(`norm-${videoCodec}-${i + 1}`),
              rawInputs[i]!.path,
              sourceInfos[i]!,
              cacheDir,
              target,
              makeResource(rawInputs[i]!.threads),
              signal,
              () => undefined,
              keepSourceSizeProfile,
              undefined,
              true,
              true
            );
            normalizedPaths.push(out);
          }

          const normalizedInfos = await Promise.all(
            normalizedPaths.map((p, idx) => analyzer.analyze(p, `probe-norm-${videoCodec}-${idx + 1}`))
          );
          const reference = normalizedInfos[0]!;
          expect(reference.colorRange).toBe('tv');
          expect(reference.colorPrimaries).toBe('bt709');
          expect(reference.colorTransfer).toBe('bt709');
          expect(reference.colorSpace).toBe('bt709');
          expect(reference.pixelFormat).toBe('yuv420p');
          expect(reference.variableFrameRate).toBe(false);

          const mismatches = normalizedInfos.slice(1).flatMap((candidate, idx) =>
            compareForConcat(reference, candidate).reasons.map(
              (reason) => `Video ${idx + 2}: ${reason}`
            )
          );
          expect(mismatches, `[${videoCodec}] Sau chuẩn hóa vẫn còn lệch concat`).toEqual([]);

          for (let i = 0; i < normalizedPaths.length; i += 1) {
            expect(Math.abs(normalizedInfos[i]!.duration - sourceInfos[i]!.duration)).toBeLessThan(0.2);
            expect(strictDecodeStatus(toolsDirectory!, normalizedPaths[i]!, '0:v:0')).toBe(0);
            expect(strictDecodeStatus(toolsDirectory!, normalizedPaths[i]!, '0:a:0')).toBe(0);
          }
        }
      },
      180_000
    );

    it(
      'chuẩn hóa giữ nguyên HDR (target.hdr = true) không bị hạ nhầm sang bt709 và vẫn đồng nhất extradata giữa các nguồn HDR khác chromaloc / số luồng',
      async () => {
        const folder = await mkdtemp(join(tmpdir(), 'tubmedia-hdr-uniform-'));
        folders.push(folder);
        const { engine, analyzer } = createStack(toolsDirectory!);
        const signal = new AbortController().signal;

        const hdr1 = runFfmpegFixture(
          toolsDirectory!,
          [
            '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
            '-vf', 'scale=in_range=tv:out_range=tv:out_color_matrix=bt2020,format=yuv420p10le,setparams=range=tv:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc',
            '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'chromaloc=0',
            '-color_range', 'tv', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-threads', '2'
          ],
          join(folder, 'hdr-01-unspec.mp4')
        );

        const hdr2 = runFfmpegFixture(
          toolsDirectory!,
          [
            '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=60:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000:duration=2',
            '-vf', 'scale=in_range=tv:out_range=tv:out_color_matrix=bt2020:out_chroma_loc=topleft,format=yuv420p10le,setparams=range=tv:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc',
            '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'chromaloc=2',
            '-chroma_sample_location', 'topleft',
            '-color_range', 'tv', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-threads', '2'
          ],
          join(folder, 'hdr-02-topleft-960p60.mp4')
        );

        const [src1, src2] = await Promise.all([
          analyzer.analyze(hdr1, 'probe-hdr-1'),
          analyzer.analyze(hdr2, 'probe-hdr-2')
        ]);
        expect(src1.hdr).toBe(true);
        expect(src2.hdr).toBe(true);

        const hdrTarget: NormalizeTarget = {
          width: 640,
          height: 360,
          fps: 30,
          hdr: true,
          videoCodec: 'hevc',
          pixelFormat: 'yuv420p10le',
          audioCodec: 'aac',
          sampleRate: 48000,
          channels: 2,
          videoBitrate: 2_800_000
        };
        const cacheDir = join(folder, '_cache-hdr');
        const out1 = await engine.normalizeToTarget(
          makeJob('hdr-norm-1'),
          hdr1,
          src1,
          cacheDir,
          hdrTarget,
          makeResource(2),
          signal,
          () => undefined,
          { ...keepSourceSizeProfile, hdrMode: 'keep' },
          undefined,
          true,
          true
        );
        const out2 = await engine.normalizeToTarget(
          makeJob('hdr-norm-2'),
          hdr2,
          src2,
          cacheDir,
          hdrTarget,
          makeResource(8),
          signal,
          () => undefined,
          { ...keepSourceSizeProfile, hdrMode: 'keep' },
          undefined,
          true,
          true
        );

        const [norm1, norm2] = await Promise.all([
          analyzer.analyze(out1, 'probe-hdr-out-1'),
          analyzer.analyze(out2, 'probe-hdr-out-2')
        ]);
        expect(norm1.hdr).toBe(true);
        expect(norm1.pixelFormat).toBe('yuv420p10le');
        expect(norm1.colorPrimaries).toBe('bt2020');
        expect(norm1.colorTransfer).toBe('smpte2084');
        expect(norm1.colorSpace).toBe('bt2020nc');
        expect(norm1.colorRange).toBe('tv');

        expect(compareForConcat(norm1, norm2)).toEqual({
          compatible: true,
          reasons: [],
          advisories: []
        });
      },
      180_000
    );
  }
);
