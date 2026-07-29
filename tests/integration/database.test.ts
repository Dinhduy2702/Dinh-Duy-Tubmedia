import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { ItemRepository } from '@main/database/repositories/item-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { MediaSourceRepository } from '@main/database/repositories/media-source-repository.js';
import { InputService } from '@main/input/input-service.js';

let folder = '';

afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function createDatabase(): { database: AppDatabase; projects: ProjectRepository } {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-'));
  const database = new AppDatabase(join(folder, 'db.sqlite'));
  return { database, projects: new ProjectRepository(database.db) };
}

function createProject(projects: ProjectRepository) {
  return projects.create({
    name: 'Danh sách thử nghiệm',
    sourceFolder: join(folder, 'source'),
    tempFolder: join(folder, 'temp'),
    outputFolder: join(folder, 'out'),
    finalFileName: 'thanh-pham',
    qualityProfileId: 'q',
    resourceProfileId: 'r'
  });
}

describe('cơ sở dữ liệu và lưu trạng thái bền vững', () => {
  it('tạo và đọc lại một dự án', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    expect(projects.get(project.id)?.name).toBe('Danh sách thử nghiệm');
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });

  it('không ghi NULL vào progress khi bộ đọc tiến trình trả NaN hoặc Infinity', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const queue = new QueueRepository(database.db);
    const job = queue.create({ projectId: project.id, type: 'merge', input: {} });

    expect(queue.update(job.id, { progress: Number.NaN }).progress).toBe(0);
    expect(queue.update(job.id, { progress: 65 }).progress).toBe(65);
    expect(queue.update(job.id, { progress: Number.POSITIVE_INFINITY }).progress).toBe(65);
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });

  it('lưu dấu chính sách tải nguồn để không dùng lại video ghép từng bị giảm chất lượng', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const input = new InputService(new ItemRepository(database.db));
    const sources = new MediaSourceRepository(database.db);
    const [item] = input.import(project.id, 'https://youtu.be/quality0001', 'replace');
    expect(item?.sourceId).toBeTruthy();

    const mediaInfo = {
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
      colorPrimaries: 'bt709',
      colorTransfer: 'bt709',
      colorSpace: 'bt709',
      hdr: false,
      audioCodec: 'aac',
      videoBitrate: 8_000_000,
      audioBitrate: 192_000,
      sampleRate: 48_000,
      channels: 2,
      channelLayout: 'stereo',
      formatName: 'mp4',
      fileSize: 500_000_000
    };
    sources.setFile(
      item!.sourceId!,
      join(folder, 'source', 'video.mp4'),
      mediaInfo,
      'valid',
      'merge-best-source-v1'
    );

    expect(sources.get(item!.sourceId!)?.downloadPolicy).toBe('merge-best-source-v1');

    sources.clearFileCache(item!.sourceId!);
    expect(sources.get(item!.sourceId!)).toMatchObject({
      sourceFile: null,
      mediaInfo: null,
      downloadPolicy: null,
      verificationStatus: 'unknown'
    });
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });

  it('tách riêng nguồn và cache giữa từng danh sách tải với từng quy trình ghép', () => {
    const { database, projects } = createDatabase();
    const downloadProject = projects.create({
      name: 'Danh sách tải 1',
      code: '__WORKBENCH_DOWNLOAD_1__',
      sourceFolder: join(folder, 'download-source'),
      tempFolder: join(folder, 'download-temp'),
      outputFolder: join(folder, 'download-out'),
      finalFileName: 'download-only',
      qualityProfileId: 'q',
      resourceProfileId: 'r'
    });
    const mergeProject = projects.create({
      name: 'Quy trình ghép 1',
      code: '__WORKBENCH_MERGE_1__',
      sourceFolder: join(folder, 'merge-source'),
      tempFolder: join(folder, 'merge-temp'),
      outputFolder: join(folder, 'merge-out'),
      finalFileName: 'thanh-pham',
      qualityProfileId: 'q',
      resourceProfileId: 'r'
    });
    const input = new InputService(new ItemRepository(database.db));
    const url = 'https://youtu.be/samevideo01';

    const [downloadItem] = input.import(downloadProject.id, `${url}\n${url}`, 'replace');
    const [mergeItem] = input.import(mergeProject.id, url, 'replace');
    const downloadItems = input.list(downloadProject.id);

    expect(downloadItems).toHaveLength(2);
    expect(downloadItems[0]?.sourceId).toBe(downloadItems[1]?.sourceId);
    expect(downloadItem?.sourceId).not.toBe(mergeItem?.sourceId);
    expect(new MediaSourceRepository(database.db).get(downloadItem!.sourceId!)?.identity).toContain(
      `::project:${downloadProject.id}`
    );
    expect(new MediaSourceRepository(database.db).get(mergeItem!.sourceId!)?.identity).toContain(
      `::project:${mergeProject.id}`
    );
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });

  it('tự chuyển nguồn dùng chung của database cũ sang nguồn riêng theo project', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const input = new InputService(new ItemRepository(database.db));
    const [legacyItem] = input.import(project.id, 'https://youtu.be/legacyscope1', 'replace');
    const oldSourceId = legacyItem!.sourceId!;
    const databasePath = database.path;

    database.db
      .prepare(
        "UPDATE media_sources SET identity=replace(identity, '::project:' || ?, ''), source_file=?, download_policy='download-list:legacy' WHERE id=?"
      )
      .run(project.id, join(folder, 'legacy-shared.mp4'), oldSourceId);
    database.db.prepare('DELETE FROM schema_migrations WHERE version=5').run();
    database.close();

    const migrated = new AppDatabase(databasePath);
    const [migratedItem] = new ItemRepository(migrated.db).list(project.id);
    const migratedSource = new MediaSourceRepository(migrated.db).get(migratedItem!.sourceId!);

    expect(migratedItem?.sourceId).not.toBe(oldSourceId);
    expect(migratedSource?.identity).toContain(`::project:${project.id}`);
    expect(migratedSource?.sourceFile).toBeNull();
    expect(migratedSource?.downloadPolicy).toBeNull();
    expect(migrated.integrityCheck()).toEqual(['ok']);
    migrated.close();
  });

  it('mặc định không xuất timeline và lưu đúng lựa chọn chỉ xuất TXT', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    expect(project.exportTimelineTxt).toBe(false);

    const updated = projects.update(project.id, { exportTimelineTxt: true });
    expect(updated.exportTimelineTxt).toBe(true);
    expect(projects.get(project.id)?.exportTimelineTxt).toBe(true);
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });

  it('ghi đè danh sách liên kết thay vì khôi phục dữ liệu cũ', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const input = new InputService(new ItemRepository(database.db));

    input.import(project.id, 'https://youtu.be/aaaaaaaaaaa\nhttps://youtu.be/bbbbbbbbbbb', 'replace');
    input.import(project.id, 'https://youtu.be/ccccccccccc', 'replace');

    const items = input.list(project.id);
    const batchCount = Number(
      (
        database.db
          .prepare('SELECT COUNT(*) AS count FROM input_batches WHERE project_id=?')
          .get(project.id) as { count: number }
      ).count
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.normalizedUrl).toContain('ccccccccccc');
    expect(batchCount).toBe(1);
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });

  it('xóa dự án sẽ xóa bền vững hàng đợi và dữ liệu nhập nhưng giữ tệp ngoài cơ sở dữ liệu', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const items = new ItemRepository(database.db);
    const input = new InputService(items);
    const queue = new QueueRepository(database.db);
    const [item] = input.import(project.id, 'https://youtu.be/ddddddddddd', 'replace');
    queue.create({
      projectId: project.id,
      type: 'download',
      itemId: item?.id ?? null,
      input: { url: item?.normalizedUrl }
    });

    projects.remove(project.id);

    expect(projects.get(project.id)).toBeNull();
    expect(items.list(project.id)).toHaveLength(0);
    expect(queue.list(project.id)).toHaveLength(0);
    expect(
      Number(
        (
          database.db
            .prepare('SELECT COUNT(*) AS count FROM input_batches WHERE project_id=?')
            .get(project.id) as { count: number }
        ).count
      )
    ).toBe(0);
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });
  it('tìm và xóa được mọi bản ghi trùng mã từ các phiên bản cũ', () => {
    const { database, projects } = createDatabase();
    const first = projects.create({
      name: 'Danh sách cũ 1',
      code: '__WORKBENCH_DOWNLOAD_1__',
      sourceFolder: join(folder, 'source-1'),
      tempFolder: join(folder, 'temp-1'),
      outputFolder: join(folder, 'out-1'),
      finalFileName: 'download-only',
      qualityProfileId: 'q',
      resourceProfileId: 'r'
    });
    const second = projects.create({
      name: 'Danh sách cũ 2',
      code: '__WORKBENCH_DOWNLOAD_1__',
      sourceFolder: join(folder, 'source-2'),
      tempFolder: join(folder, 'temp-2'),
      outputFolder: join(folder, 'out-2'),
      finalFileName: 'download-only',
      qualityProfileId: 'q',
      resourceProfileId: 'r'
    });
    const legacy = projects.create({
      name: 'Danh sách mã cũ',
      code: '__WORKBENCH_DOWNLOAD_A__',
      sourceFolder: join(folder, 'source-legacy'),
      tempFolder: join(folder, 'temp-legacy'),
      outputFolder: join(folder, 'out-legacy'),
      finalFileName: 'download-only',
      qualityProfileId: 'q',
      resourceProfileId: 'r'
    });

    const duplicates = projects.listByCodes(['__WORKBENCH_DOWNLOAD_1__', '__WORKBENCH_DOWNLOAD_A__']);
    expect(duplicates.map((project) => project.id).sort()).toEqual([first.id, second.id, legacy.id].sort());
    duplicates.forEach((project) => projects.remove(project.id));
    expect(projects.listByCodes(['__WORKBENCH_DOWNLOAD_1__', '__WORKBENCH_DOWNLOAD_A__'])).toHaveLength(0);
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });

  it('xóa toàn bộ sẽ dọn cả dự án ẩn, dữ liệu con và tác vụ toàn ứng dụng', () => {
    const { database, projects } = createDatabase();
    const first = createProject(projects);
    const second = projects.create({
      name: 'Quy trình cũ đã lưu',
      code: '__WORKBENCH_MERGE_4__',
      sourceFolder: join(folder, 'source-2'),
      tempFolder: join(folder, 'temp-2'),
      outputFolder: join(folder, 'out-2'),
      finalFileName: 'thanh-pham-2',
      qualityProfileId: 'q',
      resourceProfileId: 'r'
    });
    const input = new InputService(new ItemRepository(database.db));
    const queue = new QueueRepository(database.db);
    input.import(first.id, 'https://youtu.be/eeeeeeeeeee', 'replace');
    input.import(second.id, 'https://youtu.be/fffffffffff', 'replace');
    queue.create({ projectId: first.id, type: 'download', input: { url: 'https://youtu.be/eeeeeeeeeee' } });
    queue.create({ projectId: second.id, type: 'merge', input: {} });
    queue.create({ projectId: null, type: 'verify', input: { scope: 'global' } });

    expect(projects.removeAll()).toBe(2);
    expect(queue.clearAll()).toBe(1);

    expect(projects.list(true)).toHaveLength(0);
    expect(queue.list()).toHaveLength(0);
    expect(
      Number(
        (database.db.prepare('SELECT COUNT(*) AS count FROM project_items').get() as { count: number }).count
      )
    ).toBe(0);
    expect(
      Number(
        (database.db.prepare('SELECT COUNT(*) AS count FROM input_batches').get() as { count: number }).count
      )
    ).toBe(0);
    expect(database.integrityCheck()).toEqual(['ok']);
    database.close();
  });

  it('lưu tên video và đường dẫn đầu ra vào đúng dòng tiến trình', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const queue = new QueueRepository(database.db);
    const job = queue.create({
      projectId: project.id,
      type: 'download',
      input: { url: 'https://youtu.be/ggggggggggg', workflow: 'download-only' }
    });

    const updated = queue.updateInput(job.id, {
      displayName: 'Tiêu đề thật của video',
      outputPath: 'E:\\Videos\\Tiêu đề thật của video [ggggggggggg].mp4'
    });

    expect(updated.input).toMatchObject({
      url: 'https://youtu.be/ggggggggggg',
      workflow: 'download-only',
      displayName: 'Tiêu đề thật của video',
      outputPath: 'E:\\Videos\\Tiêu đề thật của video [ggggggggggg].mp4'
    });
    database.close();
  });

  it('lưu các mốc timeline thật để mở lại ứng dụng vẫn hiển thị đúng', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const queue = new QueueRepository(database.db);
    const job = queue.create({
      projectId: project.id,
      type: 'merge',
      input: { productName: 'thanh-pham' }
    });
    const timelineRows = [
      {
        index: 1,
        start: 0,
        end: 12.5,
        duration: 12.5,
        code: '00:00 Ph Video_001',
        label: 'Video một',
        note: 'mở đầu',
        file: 'E:\\Videos\\Video_001.mp4'
      },
      {
        index: 2,
        start: 12.5,
        end: 20,
        duration: 7.5,
        code: '00:12 Ph Video_002',
        label: 'Video hai',
        note: '',
        file: 'E:\\Videos\\Video_002.mp4'
      }
    ];

    queue.updateInput(job.id, {
      timelineTxt: 'E:\\Videos\\thanh-pham.timeline.txt',
      timelineRows
    });

    const restored = queue.get(job.id);
    expect(restored?.input.timelineTxt).toBe('E:\\Videos\\thanh-pham.timeline.txt');
    expect(restored?.input.timelineRows).toEqual(timelineRows);
    database.close();
  });

  it('tự sửa tên lỗi bảng mã và chỉ khôi phục tác vụ từng bị chặn do công cụ', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const input = new InputService(new ItemRepository(database.db));
    const queue = new QueueRepository(database.db);
    const sources = new MediaSourceRepository(database.db);
    const [item] = input.import(project.id, 'https://youtu.be/hhhhhhhhhhh', 'replace');
    const download = queue.create({
      projectId: project.id,
      type: 'download',
      sourceId: item?.sourceId ?? null,
      input: {
        url: item?.normalizedUrl,
        displayName: 'T\uFFFDm Em, Kh\uFFFDng Bu\uFFFDng'
      }
    });
    const dependent = queue.create({
      projectId: project.id,
      type: 'merge',
      input: { dependsOn: [download.id] }
    });
    const unrelated = queue.create({
      projectId: null,
      type: 'download',
      input: { url: 'https://youtu.be/iiiiiiiiiii' }
    });
    queue.update(download.id, {
      status: 'failed',
      errorCode: 'TOOL_NOT_FOUND',
      errorMessage: 'Không tìm thấy công cụ yt-dlp.'
    });
    queue.update(dependent.id, {
      status: 'failed',
      errorCode: 'DEPENDENCY_FAILED',
      errorMessage: 'Tác vụ tải phụ thuộc đã thất bại.'
    });
    queue.update(unrelated.id, {
      status: 'failed',
      errorCode: 'DOWNLOAD_FAILED',
      errorMessage: 'Video không khả dụng.'
    });
    if (item?.sourceId) {
      sources.setMetadata(item.sourceId, { title: 'T\uFFFDm Em' });
    }

    expect(queue.repairCorruptedDisplayNames()).toBe(1);
    expect(sources.clearCorruptedMetadata()).toBe(1);
    expect(queue.recoverToolBlocked()).toEqual({
      jobs: 2,
      projectIds: [project.id]
    });

    expect(queue.get(download.id)).toMatchObject({
      status: 'pending',
      errorCode: null,
      errorMessage: null,
      progress: 0
    });
    expect(queue.get(download.id)?.input.displayName).toBe(item?.normalizedUrl);
    expect(queue.get(dependent.id)?.status).toBe('pending');
    expect(queue.get(unrelated.id)?.status).toBe('failed');
    expect(item?.sourceId ? sources.get(item.sourceId)?.title : null).toBeNull();
    database.close();
  });

  it('tự khôi phục tác vụ từng thất bại vì metadata dung lượng ước tính sai', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const queue = new QueueRepository(database.db);
    const legacy = queue.create({
      projectId: project.id,
      type: 'download',
      input: { url: 'https://youtu.be/sizeestimate1' }
    });
    const unrelated = queue.create({
      projectId: project.id,
      type: 'download',
      input: { url: 'https://youtu.be/realdownload1' }
    });
    queue.update(legacy.id, {
      status: 'failed',
      attempts: 2,
      errorCode: 'DOWNLOAD_FAILED',
      errorMessage: 'Tệp tải về có dung lượng thấp bất thường và đã chuyển vào khu cách ly.'
    });
    queue.update(unrelated.id, {
      status: 'failed',
      errorCode: 'DOWNLOAD_FAILED',
      errorMessage: 'Máy chủ đã từ chối tải video.'
    });

    expect(queue.recoverLegacySizeEstimateFailures()).toBe(1);
    expect(queue.get(legacy.id)).toMatchObject({
      status: 'pending',
      progress: 0,
      attempts: 0,
      errorCode: null,
      errorMessage: null
    });
    expect(queue.get(legacy.id)?.input.progressStage).toContain('sửa kiểm tra dung lượng');
    expect(queue.get(unrelated.id)?.status).toBe('failed');
    database.close();
  });

  it('gỡ lỗi cookies bị sao chép từ bản cũ nhưng giữ đúng video đã xác nhận lỗi', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const queue = new QueueRepository(database.db);
    const inherited = queue.create({
      projectId: project.id,
      type: 'download',
      input: { url: 'https://youtu.be/jjjjjjjjjjj' }
    });
    const confirmed = queue.create({
      projectId: project.id,
      type: 'download',
      input: {
        url: 'https://youtu.be/kkkkkkkkkkk',
        cookieFailureConfirmed: true
      }
    });
    queue.update(inherited.id, {
      status: 'paused',
      errorCode: 'AUTHENTICATION_REQUIRED',
      errorMessage: 'Lỗi cookies bị sao chép từ video trước.'
    });
    queue.update(confirmed.id, {
      status: 'paused',
      errorCode: 'COOKIES_EXPIRED',
      errorMessage: 'Video này thực sự đã từ chối cookies.'
    });

    expect(queue.releaseInheritedCookieBlocks()).toBe(1);
    expect(queue.get(inherited.id)).toMatchObject({
      status: 'pending',
      errorCode: null,
      errorMessage: null
    });
    expect(queue.get(confirmed.id)).toMatchObject({
      status: 'paused',
      errorCode: 'COOKIES_EXPIRED'
    });
    database.close();
  });

  it('lưu giai đoạn ghép cùng phần trăm trong một lần cập nhật', () => {
    const { database, projects } = createDatabase();
    const project = createProject(projects);
    const queue = new QueueRepository(database.db);
    const merge = queue.create({
      projectId: project.id,
      type: 'merge',
      input: { productName: 'Thành phẩm' }
    });

    const updated = queue.update(
      merge.id,
      {
        status: 'merging',
        progress: 52.5,
        speed: '8.20x',
        etaSeconds: 19
      },
      {
        progressStage: 'Đang ghép 12 video thành một tệp',
        progressElapsedSeconds: 8
      }
    );

    expect(updated).toMatchObject({
      status: 'merging',
      progress: 52.5,
      speed: '8.20x',
      etaSeconds: 19
    });
    expect(updated.input).toMatchObject({
      progressStage: 'Đang ghép 12 video thành một tệp',
      progressElapsedSeconds: 8
    });
    database.close();
  });
});
