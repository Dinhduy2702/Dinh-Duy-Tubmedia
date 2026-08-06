import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileVerifier } from '../../src/main/media/file-verifier.js';
import type { MediaAnalyzer } from '../../src/main/media/media-analyzer.js';
import type { ProcessManager } from '../../src/main/processes/process-manager.js';
import type { ToolManager } from '../../src/main/tools/tool-manager.js';

describe('audio-only file verification', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('accepts a valid M4A without calling the video-only MediaAnalyzer path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-audio-only-'));
    temporaryRoots.push(root);
    const audioPath = join(root, 'MÊ EM - TKEY.m4a');
    await writeFile(audioPath, Buffer.from('fixture-audio'));

    const analyzer = { analyze: vi.fn(() => Promise.reject(new Error('video analyzer must not run'))) };
    const processes = {
      run: vi.fn(() => Promise.resolve({
        code: 0,
        stdoutTail: JSON.stringify({
          streams: [{ codec_type: 'audio', codec_name: 'aac', duration: '180.25' }],
          format: { duration: '180.25' }
        }),
        stderrTail: '',
        durationMs: 1
      }))
    };
    const tools = { get: vi.fn(() => ({ available: true, executablePath: 'ffprobe' })) };
    const verifier = new FileVerifier(
      analyzer as unknown as MediaAnalyzer,
      processes as unknown as ProcessManager,
      tools as unknown as ToolManager
    );

    const result = await verifier.verify(audioPath, 'standard', undefined, {
      jobId: 'audio-only-test',
      expectedStreams: { video: false, audio: true }
    });

    expect(result.ok).toBe(true);
    expect(result.duration).toBeCloseTo(180.25);
    expect(result.reasons).toEqual([]);
    expect(analyzer.analyze).not.toHaveBeenCalled();
    expect(processes.run).toHaveBeenCalledTimes(1);
  });

  it('reports a missing audio stream without incorrectly asking for video', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tubmedia-audio-missing-'));
    temporaryRoots.push(root);
    const outputPath = join(root, 'empty.m4a');
    await writeFile(outputPath, Buffer.from('fixture'));

    const verifier = new FileVerifier(
      { analyze: vi.fn() } as unknown as MediaAnalyzer,
      {
        run: vi.fn(() => Promise.resolve({
          code: 0,
          stdoutTail: JSON.stringify({ streams: [], format: { duration: '10' } }),
          stderrTail: '',
          durationMs: 1
        }))
      } as unknown as ProcessManager,
      { get: vi.fn(() => ({ available: true, executablePath: 'ffprobe' })) } as unknown as ToolManager
    );

    const result = await verifier.verify(outputPath, 'standard', undefined, {
      expectedStreams: { video: false, audio: true }
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('Không tìm thấy audio stream theo lựa chọn tải.');
    expect(result.reasons.join(' ')).not.toContain('luồng video');
  });

  it('keeps audio-mode UI text and rejects replacement-character titles', async () => {
    const [service, panel] = await Promise.all([
      readFile(new URL('../../src/main/download/quick-download-service.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/renderer/src/components/QuickDownloadPanel.tsx', import.meta.url), 'utf8')
    ]);
    expect(service).toContain('cleanExternalText');
    expect(service).toContain('titleFromOutputPath');
    expect(service).toContain("mediaMode === 'audio-only'");
    expect(panel).toContain("mediaMode === 'audio-only'");
    expect(panel).toContain('Tải toàn bộ âm thanh');
  });
});
