import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { WorkbenchService } from '@main/workbench/workbench-service.js';
import { builtInResourceProfiles } from '@main/settings/defaults.js';
import type { JobStatus, QueueJob, ResourceProfile } from '@shared/types/domain.js';
import { createQueueHarness, type QueueHarness } from './helpers/queue-harness.js';

/**
 * Tự kiểm PR #4 bằng mạng thật (2026-10-15): script gọi saveDownloadDraft với thư mục rỗng cho một danh sách đang chờ lượt
 * → bản nháp ghi đè thư mục nguồn/tạm/thành phẩm của danh sách và thay toàn bộ link trong khi các video đã xếp hàng vẫn
 * đọc thư mục đó → 3 video lỗi "ENOENT mkdir ''". Giao diện đã khóa ô nhập (đang chạy / tạm dừng) nên người dùng không gặp,
 * nhưng phía main không chặn. Giờ main từ chối lưu nháp khi danh sách / quy trình còn tác vụ chưa xong — đúng quy tắc khóa
 * của giao diện.
 */
let harness: QueueHarness;
let workbench: WorkbenchService;
let imports: Array<{ projectId: string; text: string }>;

beforeEach(() => {
  harness = createQueueHarness();
  imports = [];
  const saved: ResourceProfile[] = [];
  const settings = {
    get: () => harness.settings,
    profiles: () => ({ resources: [...builtInResourceProfiles, ...saved], qualities: [] }),
    saveResource: (profile: ResourceProfile) => {
      saved.push(profile);
      return profile;
    }
  };
  const input = {
    import: vi.fn((projectId: string, text: string) => void imports.push({ projectId, text })),
    list: () => []
  };
  workbench = new WorkbenchService(
    harness.projects,
    {} as never,
    input as never,
    harness.manager,
    {} as never,
    settings as never,
    harness.logger as never,
    {} as never
  );
});

afterEach(() => harness.cleanup());

const downloadDraft = (outputFolder: string, linksText = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') => ({
  slot: 'download-1' as const,
  name: 'Danh sách 1',
  linksText,
  outputFolder,
  tempFolder: join(outputFolder, 'tam'),
  resourceProfileId: 'resource-balanced',
  downloadWorkers: 2
});

const mergeDraft = (outputFolder: string) => ({
  slot: 'merge-1' as const,
  name: 'Quy trình 1',
  linksText: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  sourceFolder: join(outputFolder, 'nguon'),
  tempFolder: join(outputFolder, 'tam'),
  outputFolder,
  finalFileName: 'thanh-pham',
  qualityProfileId: 'quality-highest',
  resourceProfileId: 'resource-balanced',
  exportTimelineTxt: false
});

function jobFor(projectId: string, status: JobStatus): QueueJob {
  const job = harness.queue.create({ projectId, type: 'download', input: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
  if (status === 'retrying' || status === 'interrupted') harness.queue.update(job.id, { status: 'analyzing' });
  if (status === 'completed') harness.queue.update(job.id, { status: 'downloading' });
  if (status !== 'pending') harness.queue.update(job.id, { status });
  return harness.queue.get(job.id)!;
}

describe('Lưu nháp danh sách tải / quy trình ghép khi còn tác vụ chưa xong', () => {
  for (const status of ['pending', 'downloading', 'retrying', 'paused', 'interrupted'] as JobStatus[]) {
    it(`danh sách có tác vụ "${status}" → từ chối lưu nháp, thư mục và link giữ nguyên`, () => {
      const first = workbench.saveDownloadDraft(downloadDraft(join(harness.folder, 'goc')));
      const projectId = first.project!.id;
      jobFor(projectId, status);
      imports.length = 0;

      expect(() => workbench.saveDownloadDraft(downloadDraft('', ''))).toThrow(/đang tải|tạm dừng|chưa xong/);

      const project = harness.projects.get(projectId)!;
      expect(project.outputFolder).toBe(join(harness.folder, 'goc'));
      expect(project.sourceFolder).toBe(join(harness.folder, 'goc'));
      expect(project.tempFolder).toBe(join(harness.folder, 'goc', 'tam'));
      expect(imports, 'không thay danh sách link').toEqual([]);
    });
  }

  it('đang tải mà bản nháp KHÔNG đổi gì (lượt tự lưu 800 ms bắn ngay sau khi bấm Tải) → không báo lỗi, không ghi gì', () => {
    const draft = downloadDraft(join(harness.folder, 'goc'));
    const first = workbench.saveDownloadDraft(draft);
    const projectId = first.project!.id;
    jobFor(projectId, 'pending');
    imports.length = 0;

    const next = workbench.saveDownloadDraft(draft);

    expect(next.project!.id).toBe(projectId);
    expect(next.project!.outputFolder).toBe(join(harness.folder, 'goc'));
    expect(imports, 'không thay danh sách link của danh sách đang tải').toEqual([]);
  });

  it('quy trình ghép đang chạy mà bản nháp không đổi gì → không báo lỗi', () => {
    const draft = mergeDraft(join(harness.folder, 'ghep'));
    const first = workbench.saveMergeDraft(draft);
    jobFor(first.project!.id, 'merging');

    expect(() => workbench.saveMergeDraft(draft)).not.toThrow();
  });

  it('quy trình ghép có tác vụ đang chạy → từ chối lưu nháp, thư mục giữ nguyên', () => {
    const first = workbench.saveMergeDraft(mergeDraft(join(harness.folder, 'ghep')));
    const projectId = first.project!.id;
    jobFor(projectId, 'downloading');

    expect(() => workbench.saveMergeDraft(mergeDraft(''))).toThrow(/đang tải|tạm dừng|chưa xong/);
    expect(harness.projects.get(projectId)!.outputFolder).toBe(join(harness.folder, 'ghep'));
  });

  it('chỉ còn tác vụ đã xong / lỗi / hủy → vẫn lưu nháp như cũ', () => {
    const first = workbench.saveDownloadDraft(downloadDraft(join(harness.folder, 'goc')));
    const projectId = first.project!.id;
    jobFor(projectId, 'completed');
    jobFor(projectId, 'failed');
    jobFor(projectId, 'cancelled');

    const next = workbench.saveDownloadDraft(downloadDraft(join(harness.folder, 'moi')));

    expect(next.project!.outputFolder).toBe(join(harness.folder, 'moi'));
  });

  it('danh sách chưa có gì → lưu nháp tạo mới như cũ', () => {
    const next = workbench.saveDownloadDraft(downloadDraft(join(harness.folder, 'goc')));
    expect(next.project!.outputFolder).toBe(join(harness.folder, 'goc'));
  });
});
