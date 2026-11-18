import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '@main/database/database.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { SettingsRepository } from '@main/database/repositories/settings-repository.js';
import { ensureTubmediaOwnedDirectory } from '@main/files/file-ownership.js';
import {
  executePostMergeSourceCleanup,
  planPostMergeSourceCleanup
} from '@main/files/post-merge-source-cleanup.js';
import { defaultAppSettings } from '@main/settings/defaults.js';
import type { CleanupEnvironmentPaths } from '@main/system/cleanup-scanner.js';

const roots: string[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function createCleanupFixture(sameSourceAndOutput = false) {
  const root = await mkdtemp(join(tmpdir(), 'tubmedia-v15-cleanup-'));
  roots.push(root);

  const sharedFolder = join(root, 'Thanh pham');
  const sourceFolder = sameSourceAndOutput ? sharedFolder : join(root, 'Nguon');
  const outputFolder = sharedFolder;
  const tempFolder = join(root, 'Tam');
  const localAppData = join(root, 'LocalAppData');
  await mkdir(sourceFolder, { recursive: true });
  await mkdir(outputFolder, { recursive: true });
  await mkdir(tempFolder, { recursive: true });
  await mkdir(localAppData, { recursive: true });

  const database = new AppDatabase(join(root, 'studio.sqlite'));
  databases.push(database);
  const projectRepo = new ProjectRepository(database.db);
  const itemRepo = new ItemRepository(database.db);
  const sourceRepo = new MediaSourceRepository(database.db);
  const queueRepo = new QueueRepository(database.db);
  const settingsRepo = new SettingsRepository(database.db);

  const envPaths: CleanupEnvironmentPaths = {
    tempDir: join(root, 'SysTemp'),
    localAppData,
    roamingAppData: join(root, 'Roaming')
  };

  const now = new Date().toISOString();
  const addSourceAndItem = async (
    projectId: string,
    position: number,
    filePath: string,
    bytes: number,
    existingSourceId?: string
  ): Promise<string> => {
    if (!existsSync(filePath)) {
      await writeFile(filePath, Buffer.alloc(bytes, position));
    }
    const sourceId = existingSourceId ?? randomUUID();
    const url = `https://www.youtube.com/watch?v=VID_${sourceId.slice(0, 8)}`;
    if (!existingSourceId) {
      database.db
        .prepare(
          `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,title,uploader,source_file,download_policy,verification_status,media_info_json,created_at,updated_at)
           VALUES(?,?,?,?,'youtube','youtube',?,?,NULL,?,'source','valid',NULL,?,?)`
        )
        .run(sourceId, `youtube:youtube:${sourceId}`, url, url, `VID_${position}`, `Video ${position}`, filePath, now, now);
    }
    database.db
      .prepare(
        `INSERT INTO project_items(id,project_id,batch_id,position,original_text,url,normalized_url,platform,extractor_key,media_id,source_id,timestamp_start,timestamp_end,note,audio_mode,validity,warnings_json,errors_json,clip_file,enabled,created_at,updated_at)
         VALUES(?,?,NULL,?,?,?,?,'youtube','youtube',?,?,NULL,NULL,'','default','valid','[]','[]',NULL,1,?,?)`
      )
      .run(randomUUID(), projectId, position, url, url, url, `VID_${position}`, sourceId, now, now);
    return sourceId;
  };

  return {
    root,
    sourceFolder,
    outputFolder,
    tempFolder,
    localAppData,
    envPaths,
    database,
    projectRepo,
    itemRepo,
    sourceRepo,
    queueRepo,
    settingsRepo,
    addSourceAndItem
  };
}

describe('V15 — Dọn video nguồn sau khi ghép thành công vào Thùng rác (5 hàng rào an toàn)', () => {
  it('Ca 1: sourceFolder === outputFolder — chỉ dọn đúng 4 video nguồn [LINK_<12 hex>], giữ nguyên 100% thư mục thành phẩm V13 + timeline + tệp riêng của người dùng', async () => {
    const fx = await createCleanupFixture(true);
    const project = fx.projectRepo.create({
      name: 'Tong hop 1H',
      sourceFolder: fx.sourceFolder,
      tempFolder: fx.tempFolder,
      outputFolder: fx.outputFolder,
      finalFileName: 'Tong hop 1H',
      qualityProfileId: 'quality-smart-merge',
      resourceProfileId: 'resource-balanced',
      exportTimelineTxt: true,
      aspectRatio: 'original'
    });

    const srcPaths = [
      join(fx.sourceFolder, 'Clip 1 [v1] [LINK_AABBCC112233].mp4'),
      join(fx.sourceFolder, 'Clip 2 [v2] [LINK_AABBCC112234].mp4'),
      join(fx.sourceFolder, 'Clip 3 [v3] [LINK_AABBCC112235].mp4'),
      join(fx.sourceFolder, 'Clip 4 [v4] [LINK_AABBCC112236].mp4')
    ];
    for (let i = 0; i < srcPaths.length; i++) {
      await fx.addSourceAndItem(project.id, i + 1, srcPaths[i]!, 256 * 1024);
    }

    // Tệp cá nhân người dùng chép tay trong cùng thư mục (không có [LINK_<12 hex>]) — dù có lỡ gắn vào media_sources cũng phải giữ
    const userPersonalVideo = join(fx.sourceFolder, 'Ky niem gia dinh.mp4');
    await fx.addSourceAndItem(project.id, 5, userPersonalVideo, 128 * 1024);

    // Thư mục thành phẩm V13 nằm ngay trong cùng thư mục sourceFolder === outputFolder
    const productDir = join(fx.outputFolder, 'Tong hop 1H');
    await mkdir(productDir, { recursive: true });
    const finalMp4 = join(productDir, 'Tong hop 1H.mp4');
    const finalTimeline = join(productDir, 'Tong hop 1H.timeline.txt');
    await writeFile(finalMp4, Buffer.alloc(1024 * 1024, 9));
    await writeFile(finalTimeline, '00:00 Ph Video_001\r\n', 'utf8');

    const mergeJob = fx.queueRepo.create({
      projectId: project.id,
      type: 'merge',
      input: {
        productName: 'Tong hop 1H',
        outputFolder: fx.outputFolder,
        outputPath: finalMp4,
        timelineTxt: finalTimeline,
        timelineOnly: false
      }
    });
    fx.queueRepo.update(mergeJob.id, { status: 'merging' });
    fx.queueRepo.update(mergeJob.id, { status: 'completed' });
    fx.projectRepo.setStatus(project.id, 'completed');

    const trashed: string[] = [];
    const deps = {
      projects: fx.projectRepo,
      items: fx.itemRepo,
      sources: fx.sourceRepo,
      queue: fx.queueRepo,
      envPaths: () => fx.envPaths,
      readRecycleBinCapacity: () => Promise.resolve({ supported: true, maxBytes: 10 * 1024 * 1024 * 1024 }),
      trashItem: async (p: string) => {
        trashed.push(p);
        await rm(p, { force: true });
      }
    };

    const preview = await planPostMergeSourceCleanup(project.id, deps);
    expect(preview.eligible).toBe(true);
    expect(preview.canTrash).toBe(true);
    expect(preview.eligibleCount).toBe(4);
    expect(preview.eligibleBytes).toBe(4 * 256 * 1024);

    const result = await executePostMergeSourceCleanup(project.id, deps);
    expect(result.trashedCount).toBe(4);
    expect(trashed.sort()).toEqual([...srcPaths].sort());

    // Thành phẩm V13 + timeline + tệp riêng của người dùng còn nguyên 100%
    expect(existsSync(finalMp4)).toBe(true);
    expect(existsSync(finalTimeline)).toBe(true);
    expect(existsSync(userPersonalVideo)).toBe(true);
  });

  it('Ca 2: giữ nguyên video đang dùng ở Danh sách B chưa xong và video có mặt trong nháp CapCut, chỉ dọn phần còn lại + xoá _normalized-cache', async () => {
    const fx = await createCleanupFixture(false);
    const projectA = fx.projectRepo.create({
      name: 'Danh sach A',
      sourceFolder: fx.sourceFolder,
      tempFolder: fx.tempFolder,
      outputFolder: fx.outputFolder,
      finalFileName: 'Danh sach A',
      qualityProfileId: 'quality-smart-merge',
      resourceProfileId: 'resource-balanced'
    });
    const projectB = fx.projectRepo.create({
      name: 'Danh sach B dang tam dung',
      sourceFolder: fx.sourceFolder,
      tempFolder: join(fx.root, 'Tam-B'),
      outputFolder: fx.outputFolder,
      finalFileName: 'Danh sach B',
      qualityProfileId: 'quality-smart-merge',
      resourceProfileId: 'resource-balanced'
    });
    fx.projectRepo.setStatus(projectB.id, 'paused');

    const v1 = join(fx.sourceFolder, 'V1 [id1] [LINK_111111111111].mp4');
    const v2Shared = join(fx.sourceFolder, 'V2 [id2] [LINK_222222222222].mp4');
    const v3CapCut = join(fx.sourceFolder, 'V3 [id3] [LINK_333333333333].mp4');
    const v4 = join(fx.sourceFolder, 'V4 [id4] [LINK_444444444444].mp4');

    await fx.addSourceAndItem(projectA.id, 1, v1, 100_000);
    const s2 = await fx.addSourceAndItem(projectA.id, 2, v2Shared, 200_000);
    await fx.addSourceAndItem(projectA.id, 3, v3CapCut, 300_000);
    await fx.addSourceAndItem(projectA.id, 4, v4, 400_000);

    // Danh sách B đang tạm dừng cũng dùng chung Video #2
    await fx.addSourceAndItem(projectB.id, 1, v2Shared, 200_000, s2);
    const bJob = fx.queueRepo.create({ projectId: projectB.id, type: 'merge', input: {} });
    fx.queueRepo.update(bJob.id, { status: 'paused' });

    // Nháp CapCut tham chiếu tới Video #3
    const capcutDraftDir = join(fx.localAppData, 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft', 'Project-99');
    await mkdir(capcutDraftDir, { recursive: true });
    await writeFile(
      join(capcutDraftDir, 'draft_content.json'),
      JSON.stringify({ materials: { videos: [{ path: v3CapCut.replace(/\\/g, '/') }] } }),
      'utf8'
    );

    // Tạo _normalized-cache có dấu sở hữu của Tubmedia trong tempFolder của Danh sách A
    const normCacheDir = join(fx.tempFolder, '_normalized-cache');
    await mkdir(normCacheDir, { recursive: true });
    await ensureTubmediaOwnedDirectory(normCacheDir, 'normalize-cache');
    await writeFile(join(normCacheDir, 'norm-1.mp4'), Buffer.alloc(64_000, 5));

    const productDir = join(fx.outputFolder, 'Danh sach A');
    await mkdir(productDir, { recursive: true });
    const finalMp4 = join(productDir, 'Danh sach A.mp4');
    await writeFile(finalMp4, Buffer.alloc(512_000, 8));
    const mergeA = fx.queueRepo.create({
      projectId: projectA.id,
      type: 'merge',
      input: { outputPath: finalMp4, timelineOnly: false }
    });
    fx.queueRepo.update(mergeA.id, { status: 'merging' });
    fx.queueRepo.update(mergeA.id, { status: 'completed' });
    fx.projectRepo.setStatus(projectA.id, 'completed');

    const trashed: string[] = [];
    const deps = {
      projects: fx.projectRepo,
      items: fx.itemRepo,
      sources: fx.sourceRepo,
      queue: fx.queueRepo,
      envPaths: () => fx.envPaths,
      readRecycleBinCapacity: () => Promise.resolve({ supported: true, maxBytes: 5 * 1024 * 1024 * 1024 }),
      trashItem: async (p: string) => {
        trashed.push(p);
        await rm(p, { force: true });
      }
    };

    const preview = await planPostMergeSourceCleanup(projectA.id, deps);
    expect(preview.eligibleCount).toBe(2);
    expect(preview.keptItems).toHaveLength(2);
    expect(preview.keptItems.map((k) => k.reason).sort()).toEqual([
      'capcut_draft_reference',
      'shared_incomplete_project'
    ]);

    const result = await executePostMergeSourceCleanup(projectA.id, deps);
    expect(result.trashedCount).toBe(2);
    expect(trashed.sort()).toEqual([v1, v4].sort());
    expect(existsSync(v2Shared)).toBe(true);
    expect(existsSync(v3CapCut)).toBe(true);
    expect(existsSync(normCacheDir)).toBe(false);
  });

  it('Ca 3: tổng dung lượng cần dọn vượt hạn mức Thùng rác -> dừng trước khi xoá, trả thông báo tiếng Việt rõ con số, 0 tệp bị đụng', async () => {
    const fx = await createCleanupFixture(false);
    const project = fx.projectRepo.create({
      name: 'Danh sach nang',
      sourceFolder: fx.sourceFolder,
      tempFolder: fx.tempFolder,
      outputFolder: fx.outputFolder,
      finalFileName: 'Danh sach nang',
      qualityProfileId: 'quality-smart-merge',
      resourceProfileId: 'resource-balanced'
    });
    const heavy1 = join(fx.sourceFolder, 'Heavy 1 [h1] [LINK_555555555555].mp4');
    const heavy2 = join(fx.sourceFolder, 'Heavy 2 [h2] [LINK_666666666666].mp4');
    await fx.addSourceAndItem(project.id, 1, heavy1, 5 * 1024 * 1024);
    await fx.addSourceAndItem(project.id, 2, heavy2, 5 * 1024 * 1024);

    const finalMp4 = join(fx.outputFolder, 'Danh sach nang.mp4');
    await writeFile(finalMp4, Buffer.alloc(1024 * 1024, 3));
    const mergeJob = fx.queueRepo.create({
      projectId: project.id,
      type: 'merge',
      input: { outputPath: finalMp4, timelineOnly: false }
    });
    fx.queueRepo.update(mergeJob.id, { status: 'merging' });
    fx.queueRepo.update(mergeJob.id, { status: 'completed' });
    fx.projectRepo.setStatus(project.id, 'completed');

    const trashed: string[] = [];
    const deps = {
      projects: fx.projectRepo,
      items: fx.itemRepo,
      sources: fx.sourceRepo,
      queue: fx.queueRepo,
      envPaths: () => fx.envPaths,
      // Giả lập Thùng rác chỉ chứa tối đa 4 MiB trong khi nguồn nặng 10 MiB
      readRecycleBinCapacity: () => Promise.resolve({ supported: true, maxBytes: 4 * 1024 * 1024 }),
      trashItem: (p: string) => {
        trashed.push(p);
        return Promise.resolve();
      }
    };

    const preview = await planPostMergeSourceCleanup(project.id, deps);
    expect(preview.eligible).toBe(true);
    expect(preview.canTrash).toBe(false);
    expect(preview.blockedReason).toMatch(/Thùng rác/);
    expect(preview.blockedReason).toMatch(/10/);
    expect(preview.blockedReason).toMatch(/4/);

    const result = await executePostMergeSourceCleanup(project.id, deps);
    expect(result.trashedCount).toBe(0);
    expect(trashed).toHaveLength(0);
    expect(existsSync(heavy1)).toBe(true);
    expect(existsSync(heavy2)).toBe(true);
  });

  it('Ca 4: sau khi dọn xong thì clearFileCache đặt source_file = null để dán lại link không nổ ENOENT; chặn timelineOnly và lưu cài đặt tương thích ngược', async () => {
    const fx = await createCleanupFixture(false);
    const project = fx.projectRepo.create({
      name: 'Danh sach C',
      sourceFolder: fx.sourceFolder,
      tempFolder: fx.tempFolder,
      outputFolder: fx.outputFolder,
      finalFileName: 'Danh sach C',
      qualityProfileId: 'quality-smart-merge',
      resourceProfileId: 'resource-balanced'
    });
    const clip = join(fx.sourceFolder, 'Clip C [c1] [LINK_777777777777].mp4');
    const sourceId = await fx.addSourceAndItem(project.id, 1, clip, 200_000);

    // Khi đang là timelineOnly: không cho phép dọn nguồn
    const tlJob = fx.queueRepo.create({
      projectId: project.id,
      type: 'merge',
      input: { timelineTxt: join(fx.outputFolder, 'Danh sach C.timeline.txt'), timelineOnly: true }
    });
    fx.queueRepo.update(tlJob.id, { status: 'merging' });
    fx.queueRepo.update(tlJob.id, { status: 'completed' });

    const deps = {
      projects: fx.projectRepo,
      items: fx.itemRepo,
      sources: fx.sourceRepo,
      queue: fx.queueRepo,
      envPaths: () => fx.envPaths,
      readRecycleBinCapacity: () => Promise.resolve({ supported: true, maxBytes: 1024 * 1024 * 1024 }),
      trashItem: async (p: string) => {
        await rm(p, { force: true });
      }
    };

    const tlPreview = await planPostMergeSourceCleanup(project.id, deps);
    expect(tlPreview.eligible).toBe(false);
    expect(existsSync(clip)).toBe(true);

    // Chuyển sang ghép thật có MP4 hoàn tất -> dọn xong source_file phải về null
    const finalMp4 = join(fx.outputFolder, 'Danh sach C.mp4');
    await writeFile(finalMp4, Buffer.alloc(300_000, 4));
    const realMerge = fx.queueRepo.create({
      projectId: project.id,
      type: 'merge',
      input: { outputPath: finalMp4, timelineOnly: false }
    });
    fx.queueRepo.update(realMerge.id, { status: 'merging' });
    fx.queueRepo.update(realMerge.id, { status: 'completed' });
    fx.projectRepo.setStatus(project.id, 'completed');

    const done = await executePostMergeSourceCleanup(project.id, deps);
    expect(done.trashedCount).toBe(1);
    expect(existsSync(clip)).toBe(false);
    const refreshedSource = fx.sourceRepo.get(sourceId);
    expect(refreshedSource?.sourceFile).toBeNull();
    expect(refreshedSource?.verificationStatus).toBe('unknown');

    // Kiểm tra postMergeSourceCleanupMode nằm ngoài khối 'app' để tương thích quay lui 1.5.0+
    fx.settingsRepo.saveAppSettings({ ...defaultAppSettings, postMergeSourceCleanupMode: 'auto_trash' });
    const rawAppRow = JSON.parse(
      (fx.database.db.prepare("SELECT value_json FROM app_settings WHERE key='app'").get() as { value_json: string })
        .value_json
    ) as Record<string, unknown>;
    expect(Object.keys(rawAppRow)).not.toContain('postMergeSourceCleanupMode');
    expect(fx.settingsRepo.getAppSettings(defaultAppSettings).postMergeSourceCleanupMode).toBe('auto_trash');
  });
});
