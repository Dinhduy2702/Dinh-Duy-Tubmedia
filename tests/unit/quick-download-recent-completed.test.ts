import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  shell: { showItemInFolder: vi.fn() }
}));

import { QuickDownloadService } from '../../src/main/download/quick-download-service.js';
import type { QuickDownloadStatus } from '../../src/shared/quick-download.js';

// Đợt 5 mục 13 (rà soát bản cài 1.5.0): trang "Xem trước & Cắt" báo "Chưa có video nào tải xong" dù Tải nhanh có 4 video
// hoàn tất — vì chỉ xét tác vụ Tải nhanh GẦN NHẤT (lúc đó là một tác vụ đã hủy). Dịch vụ phải cho biết các video tải xong
// gần đây mà tệp vẫn còn trên máy, mới nhất trước.

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
});

function status(taskId: string, phase: QuickDownloadStatus['phase'], startedAt: string, outputPath: string | null): QuickDownloadStatus {
  return {
    taskId,
    mode: 'full',
    mediaMode: 'video-audio',
    phase,
    progress: phase === 'completed' ? 100 : 30,
    title: `Video ${taskId}`,
    message: '',
    speed: '',
    eta: '',
    downloadedBytes: 0,
    totalBytes: 0,
    outputPath,
    outputDirectory: outputPath ? join(outputPath, '..') : '',
    requestedStartSeconds: null,
    requestedEndSeconds: null,
    actualDurationSeconds: null,
    accurateCut: false,
    startedAt,
    completedAt: phase === 'completed' || phase === 'cancelled' ? startedAt : null,
    error: null,
    errorCode: null,
    warnings: []
  };
}

async function serviceWith(statuses: (output: string) => QuickDownloadStatus[]): Promise<QuickDownloadService> {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-quick-recent-'));
  roots.push(root);
  const output = join(root, 'output');
  const stateDirectory = join(root, 'state');
  await mkdir(output, { recursive: true });
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, 'state.json'), JSON.stringify({ version: 1, statuses: statuses(output) }), 'utf8');
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new QuickDownloadService({} as never, {} as never, {} as never, logger as never, stateDirectory);
  await service.recover();
  return service;
}

async function touch(path: string): Promise<string> {
  await writeFile(path, 'video');
  return path;
}

describe('QuickDownloadService.recentCompleted (Đợt 5 mục 13)', () => {
  it('tác vụ gần nhất đã hủy vẫn liệt kê đủ các video đã tải xong, mới nhất trước', async () => {
    let files: string[] = [];
    const service = await serviceWith((output) => {
      files = [1, 2, 3, 4].map((index) => join(output, `video-${index}.mp4`));
      return [
        status('a', 'completed', '2026-10-01T08:00:00.000Z', files[0]!),
        status('b', 'completed', '2026-10-01T09:00:00.000Z', files[1]!),
        status('c', 'completed', '2026-10-01T10:00:00.000Z', files[2]!),
        status('d', 'completed', '2026-10-01T11:00:00.000Z', files[3]!),
        status('huy', 'cancelled', '2026-10-01T12:00:00.000Z', null)
      ];
    });
    await Promise.all(files.map(touch));

    expect(service.currentStatus()?.phase).toBe('cancelled');
    const recent = await service.recentCompleted();
    expect(recent.map((item) => item.taskId)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('bỏ qua video đã bị xóa/di chuyển khỏi máy và tác vụ chưa xong/thất bại', async () => {
    let kept = '';
    const service = await serviceWith((output) => {
      kept = join(output, 'con.mp4');
      return [
        status('con', 'completed', '2026-10-01T08:00:00.000Z', kept),
        status('da-xoa', 'completed', '2026-10-01T09:00:00.000Z', join(output, 'da-xoa.mp4')),
        status('loi', 'failed', '2026-10-01T10:00:00.000Z', join(output, 'loi.mp4')),
        status('gian-doan', 'downloading', '2026-10-01T11:00:00.000Z', join(output, 'do-dang.mp4'))
      ];
    });
    await touch(kept);
    await touch(kept.replace('con.mp4', 'loi.mp4'));
    await touch(kept.replace('con.mp4', 'do-dang.mp4'));

    expect((await service.recentCompleted()).map((item) => item.taskId)).toEqual(['con']);
  });

  it('giới hạn số video trả về', async () => {
    let files: string[] = [];
    const service = await serviceWith((output) => {
      files = Array.from({ length: 8 }, (_, index) => join(output, `v${index}.mp4`));
      return files.map((file, index) => status(`t${index}`, 'completed', `2026-10-01T0${index}:00:00.000Z`, file));
    });
    await Promise.all(files.map(touch));

    expect((await service.recentCompleted(3)).map((item) => item.taskId)).toEqual(['t7', 't6', 't5']);
  });
});
