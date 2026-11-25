import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executePostMergeSourceCleanup,
  planPostMergeSourceCleanup,
  type PostMergeSourceCleanupDeps
} from '../../src/main/files/post-merge-source-cleanup.js';
import type { MediaSource, Project, ProjectItem, QueueJob } from '../../src/shared/types/domain.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-21-cleanup-'));
  roots.push(root);
  const sourceFolder = join(root, 'nguon');
  const tempFolder = join(root, 'tam');
  const outputFolder = join(root, 'ra');
  const productFolder = join(outputFolder, 'Thanh-pham');
  await mkdir(sourceFolder, { recursive: true });
  await mkdir(tempFolder, { recursive: true });
  await mkdir(productFolder, { recursive: true });

  const mergedOutput = join(productFolder, 'Thanh-pham.mp4');
  await writeFile(mergedOutput, 'merged-video-bytes');

  const sharedStandaloneFile = join(sourceFolder, 'video-a [LINK_AABBCCDDEEFF].mp4');
  const sharedTimelineOnlyFile = join(sourceFolder, 'video-b [LINK_112233445566].mp4');
  const ownOnlyFile = join(sourceFolder, 'video-c [LINK_998877665544].mp4');
  const clipFile = join(tempFolder, 'clip-1-item-c.mp4');
  await writeFile(sharedStandaloneFile, 'standalone-bytes');
  await writeFile(sharedTimelineOnlyFile, 'timeline-only-bytes');
  await writeFile(ownOnlyFile, 'own-bytes');
  await writeFile(clipFile, 'clip-temp-bytes');

  const projMerged = {
    id: 'proj-merged',
    status: 'completed',
    sourceFolder,
    tempFolder,
    outputFolder
  } as Project;
  const projStandalone = {
    id: 'proj-standalone',
    status: 'completed',
    sourceFolder,
    tempFolder,
    outputFolder
  } as Project;
  const projTimelineOnly = {
    id: 'proj-timeline-only',
    status: 'completed',
    sourceFolder,
    tempFolder,
    outputFolder
  } as Project;

  const jobsByProject: Record<string, QueueJob[]> = {
    'proj-merged': [
      { id: 'j-m-dl', projectId: 'proj-merged', type: 'download', status: 'completed', input: {} } as QueueJob,
      {
        id: 'j-m-merge',
        projectId: 'proj-merged',
        type: 'merge',
        status: 'completed',
        input: { outputPath: mergedOutput, timelineOnly: false }
      } as unknown as QueueJob
    ],
    // Dự án tải độc lập: đã hoàn thành, KHÔNG có job merge
    'proj-standalone': [
      { id: 'j-s-dl', projectId: 'proj-standalone', type: 'download', status: 'completed', input: {} } as QueueJob
    ],
    // Dự án chỉ tạo Timeline: đã hoàn thành, timelineOnly === true
    'proj-timeline-only': [
      { id: 'j-t-dl', projectId: 'proj-timeline-only', type: 'download', status: 'completed', input: {} } as QueueJob,
      {
        id: 'j-t-merge',
        projectId: 'proj-timeline-only',
        type: 'merge',
        status: 'completed',
        input: { timelineOnly: true }
      } as unknown as QueueJob
    ]
  };

  const sourcesById: Record<string, MediaSource> = {
    'src-a': { id: 'src-a', sourceFile: sharedStandaloneFile } as MediaSource,
    'src-b': { id: 'src-b', sourceFile: sharedTimelineOnlyFile } as MediaSource,
    'src-c': { id: 'src-c', sourceFile: ownOnlyFile } as MediaSource
  };

  const itemsByProject: Record<string, ProjectItem[]> = {
    'proj-merged': [
      { id: 'item-a', projectId: 'proj-merged', sourceId: 'src-a', clipFile: null } as ProjectItem,
      { id: 'item-b', projectId: 'proj-merged', sourceId: 'src-b', clipFile: null } as ProjectItem,
      { id: 'item-c', projectId: 'proj-merged', sourceId: 'src-c', clipFile } as ProjectItem
    ],
    'proj-standalone': [
      { id: 'item-s-a', projectId: 'proj-standalone', sourceId: 'src-a', clipFile: null } as ProjectItem
    ],
    'proj-timeline-only': [
      { id: 'item-t-b', projectId: 'proj-timeline-only', sourceId: 'src-b', clipFile: null } as ProjectItem
    ]
  };

  const setClipFile = vi.fn();
  const clearFileCache = vi.fn();
  const trashedPaths: string[] = [];

  const deps: PostMergeSourceCleanupDeps = {
    projects: {
      get: (id: string) => [projMerged, projStandalone, projTimelineOnly].find((p) => p.id === id) ?? null,
      list: () => [projMerged, projStandalone, projTimelineOnly]
    } as never,
    items: {
      list: (pid: string) => itemsByProject[pid] ?? [],
      setClipFile
    },
    sources: {
      get: (id: string) => sourcesById[id] ?? null,
      othersUsingFile: () => [],
      clearFileCache,
      listSourceFiles: () => [sharedStandaloneFile, sharedTimelineOnlyFile, ownOnlyFile]
    } as never,
    queue: {
      list: (pid?: string) => (pid ? (jobsByProject[pid] ?? []) : Object.values(jobsByProject).flat())
    },
    envPaths: () => ({
      roamingAppData: root,
      localAppData: root,
      tempDir: root,
      userData: root,
      capcutDraftRoots: []
    }),
    readRecycleBinCapacity: () => Promise.resolve({ supported: true, maxBytes: 1024 * 1024 * 1024 }),
    trashItem: async (p: string) => {
      trashedPaths.push(p);
      await rm(p, { force: true });
    }
  };

  return { deps, sharedStandaloneFile, sharedTimelineOnlyFile, ownOnlyFile, clipFile, setClipFile, trashedPaths };
}

describe('Lỗi #21: bảo vệ nguồn dự án tải độc lập / timelineOnly và xóa clipFile trong DB sau dọn tạm', () => {
  it('bảo vệ tuyệt đối nguồn thuộc dự án tải độc lập và dự án timelineOnly đã hoàn thành', async () => {
    const { deps, sharedStandaloneFile, sharedTimelineOnlyFile, ownOnlyFile, clipFile, setClipFile, trashedPaths } =
      await makeWorkspace();

    const preview = await planPostMergeSourceCleanup('proj-merged', deps);
    expect(preview.eligibleCount).toBe(1);
    expect(preview.keptItems.map((k) => k.path)).toEqual(
      expect.arrayContaining([sharedStandaloneFile, sharedTimelineOnlyFile])
    );

    const result = await executePostMergeSourceCleanup('proj-merged', deps);
    expect(result.trashedCount).toBe(1);
    expect(trashedPaths).toEqual([ownOnlyFile]);
    expect(existsSync(sharedStandaloneFile)).toBe(true);
    expect(existsSync(sharedTimelineOnlyFile)).toBe(true);
    expect(existsSync(clipFile)).toBe(false);
    expect(setClipFile).toHaveBeenCalledWith('item-c', null);
  });
});
