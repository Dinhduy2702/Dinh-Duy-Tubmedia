import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { QuarantineRepository } from '@main/database/repositories/quarantine-repository.js';
import { QuarantineMoveError, QuarantineService } from '@main/media/quarantine-service.js';
import type { Project } from '@shared/types/domain.js';

// Mục 5 (2026-10-02). Mọi tệp chỉ nằm trong os.tmpdir(): "gốc ổ đĩa" được giả lập bằng rootOf để bài kiểm
// không bao giờ ghi vào C:\Tubmedia hay E:\Tubmedia thật.

let folder = '';
let driveRoot = '';
let database: AppDatabase;
let projects: ProjectRepository;
let items: QuarantineRepository;
let project: Project;
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

const make = (overrides: Partial<ConstructorParameters<typeof QuarantineService>[1]> = {}): QuarantineService =>
  new QuarantineService(logger as never, {
    items,
    projects,
    rootOf: () => driveRoot,
    ...overrides
  });

const writeSource = (name: string, bytes = 1000): string => {
  const path = join(folder, 'E', 'DinhDuy', 'NA375', 'video', name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes, 7));
  return path;
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-quarantine-svc-'));
  driveRoot = join(folder, 'E');
  mkdirSync(driveRoot, { recursive: true });
  database = new AppDatabase(join(folder, 'db.sqlite'));
  projects = new ProjectRepository(database.db);
  items = new QuarantineRepository(database.db);
  project = projects.create({
    name: 'Danh sách 1',
    sourceFolder: join(driveRoot, 'DinhDuy', 'NA375', 'video'),
    tempFolder: join(folder, 'Downloads'),
    outputFolder: join(driveRoot, 'DinhDuy', 'NA375', 'video'),
    finalFileName: 'x',
    qualityProfileId: 'q',
    resourceProfileId: 'r'
  });
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
});

afterEach(() => {
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

describe('QuarantineService.move — một chỗ duy nhất, cùng ổ, có kiểm tra lại', () => {
  it('chuyển vào <ổ>\\Tubmedia\\quarantine\\<tên (mã ngắn)>, ghi README, theo dõi trong CSDL', async () => {
    const source = writeSource('Video A [LINK_AAAAAAAAAAAA].mp4', 1234);
    const target = await make().move(source, 'Tệp cũ không khớp chính sách.', {
      jobId: 'job-1',
      projectId: project.id,
      sourceId: 'src-1',
      kind: 'outdated-source'
    });

    const expectedFolder = join(driveRoot, 'Tubmedia', 'quarantine', `Danh sách 1 (${project.id.slice(0, 8)})`);
    expect(dirname(target)).toBe(expectedFolder);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(driveRoot, 'Tubmedia', 'README.txt'), 'utf8')).toContain('Có xóa được không');

    const [item] = items.listActive();
    expect(item).toMatchObject({
      projectId: project.id,
      jobId: 'job-1',
      sourceId: 'src-1',
      kind: 'outdated-source',
      originalPath: source,
      quarantinePath: target,
      bytes: 1234,
      replacedAt: null,
      deletedAt: null
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'quarantine',
      'FILE_QUARANTINED',
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({ original: source, target, bytes: 1234, verified: true }) as unknown
      })
    );
  });

  it('README đã có thì không ghi đè (người dùng có thể đã sửa)', async () => {
    mkdirSync(join(driveRoot, 'Tubmedia'), { recursive: true });
    writeFileSync(join(driveRoot, 'Tubmedia', 'README.txt'), 'ghi chú của tôi');
    await make().move(writeSource('b.mp4'), 'lỗi', { jobId: 'j', projectId: project.id });
    expect(readFileSync(join(driveRoot, 'Tubmedia', 'README.txt'), 'utf8')).toBe('ghi chú của tôi');
  });

  it('B4: nếu sau khi chuyển tệp KHÔNG thật sự nằm trong khu cách ly thì báo lỗi, không ghi "đã chuyển", không theo dõi', async () => {
    const source = writeSource('c.mp4');
    const service = make({ fsOps: { rename: () => Promise.resolve() } });
    const error = await service.move(source, 'lỗi', { jobId: 'j', projectId: project.id }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuarantineMoveError);
    expect(String((error as Error).message)).not.toContain('đã chuyển vào khu cách ly');
    expect(String((error as Error).message)).toContain(source);
    expect(existsSync(source)).toBe(true);
    expect(items.listActive()).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalledWith('quarantine', 'FILE_QUARANTINED', expect.anything(), expect.anything());
  });

  it('B4: kích thước bản trong khu cách ly khác bản gốc → không coi là đã chuyển', async () => {
    const source = writeSource('d.mp4', 500);
    const service = make({
      fsOps: {
        rename: (_from: string, to: string) => {
          writeFileSync(to, Buffer.alloc(10));
          return Promise.resolve();
        }
      }
    });
    await expect(service.move(source, 'lỗi', { jobId: 'j', projectId: project.id })).rejects.toBeInstanceOf(
      QuarantineMoveError
    );
    expect(existsSync(source)).toBe(true);
    expect(items.listActive()).toHaveLength(0);
  });

  it('tệp gốc không tồn tại → báo lỗi rõ ràng, không theo dõi', async () => {
    await expect(
      make().move(join(folder, 'khong-co.mp4'), 'lỗi', { jobId: 'j', projectId: project.id })
    ).rejects.toBeInstanceOf(QuarantineMoveError);
    expect(items.listActive()).toHaveLength(0);
  });

  it('gốc ổ không ghi được → lùi về <thành phẩm>\\Tubmedia\\quarantine (cùng ổ), có README, theo dõi, xóa được', async () => {
    // "Tubmedia" ở gốc ổ là một TỆP → không tạo được thư mục khu cách ly ở gốc ổ.
    writeFileSync(join(driveRoot, 'Tubmedia'), 'chặn');
    const output = join(driveRoot, 'DinhDuy', 'NA375', 'out');
    projects.update(project.id, { outputFolder: output });

    const target = await make().move(writeSource('m.mp4', 321), 'cũ', { jobId: 'j', projectId: project.id });
    expect(target.startsWith(join(output, 'Tubmedia', 'quarantine', `Danh sách 1 (${project.id.slice(0, 8)})`))).toBe(true);
    expect(readFileSync(target)).toHaveLength(321);
    expect(readFileSync(join(output, 'Tubmedia', 'README.txt'), 'utf8')).toContain('KHU CÁCH LY');
    expect(logger.warn).toHaveBeenCalledWith(
      'quarantine',
      'QUARANTINE_ROOT_FALLBACK',
      expect.stringContaining(join(output, 'Tubmedia', 'quarantine')),
      expect.anything()
    );

    const [result] = await make().deleteItems([items.listActive()[0]!.id]);
    expect(result?.ok).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it('gốc ổ báo EPERM khi tạo thư mục → cũng lùi về thư mục thành phẩm', async () => {
    const output = join(driveRoot, 'out2');
    projects.update(project.id, { outputFolder: output });
    const realMkdir = (await import('node:fs/promises')).mkdir;
    const mkdirSpy = async (path: string, options?: { recursive?: boolean }): Promise<void> => {
      if (path.startsWith(join(driveRoot, 'Tubmedia'))) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      await realMkdir(path, options);
    };
    const target = await make({ fsOps: { mkdir: mkdirSpy } }).move(writeSource('n.mp4'), 'cũ', {
      jobId: 'j',
      projectId: project.id
    });
    expect(target.startsWith(join(output, 'Tubmedia', 'quarantine'))).toBe(true);
    expect(existsSync(join(driveRoot, 'Tubmedia'))).toBe(false);
  });
});

describe('B3: bản cũ được theo dõi qua các lượt thử lại', () => {
  it('lượt 1 cách ly bản cũ rồi lỗi cookies; lượt 2 (phiên khác) tải xong → bản cũ VẪN CÒN và được báo "Đã giữ bản cũ"', async () => {
    const source = writeSource('Lion [VBa4D9D6Gng] [LINK_D1F9852209EB].mp4', 2048);
    const attempt1 = make();
    const kept = await attempt1.move(source, 'Tệp cũ không khớp chính sách.', {
      jobId: 'job-lion',
      projectId: project.id,
      sourceId: 'src-lion',
      kind: 'outdated-source'
    });
    // Lượt 1 thất bại (cookies hết hạn) — không có gì được gọi thêm.

    // Lượt 2: một thể hiện khác (ví dụ sau khi mở lại app) — không còn biến tạm nào từ lượt 1.
    writeFileSync(source, Buffer.alloc(4096, 1));
    const attempt2 = make();
    const settled = await attempt2.settleReplacement({
      jobId: 'job-lion',
      projectId: project.id,
      sourceId: 'src-lion',
      replacementPath: source
    });

    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ quarantinePath: kept, replacementPath: source, bytes: 2048 });
    expect(existsSync(kept)).toBe(true);
    expect(items.listActive()[0]?.replacedAt).not.toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      'download',
      'SOURCE_OLD_VERSION_KEPT',
      expect.stringContaining('Đã giữ bản cũ'),
      expect.objectContaining({ jobId: 'job-lion', projectId: project.id })
    );

    // Gọi lại không báo trùng.
    await expect(attempt2.settleReplacement({ jobId: 'job-lion', projectId: project.id, sourceId: 'src-lion', replacementPath: source })).resolves.toEqual([]);
  });

  it('tác vụ mới cho cùng nguồn (khác jobId) vẫn nhận ra bản cũ đang chờ', async () => {
    await make().move(writeSource('e.mp4'), 'cũ', {
      jobId: 'job-old',
      projectId: project.id,
      sourceId: 'src-e',
      kind: 'outdated-source'
    });
    const settled = await make().settleReplacement({
      jobId: 'job-new',
      projectId: project.id,
      sourceId: 'src-e',
      replacementPath: 'E:\\x.mp4'
    });
    expect(settled).toHaveLength(1);
  });

  it('tệp lỗi (không phải bản cũ) không bị coi là bản cũ được thay', async () => {
    await make().move(writeSource('f.mp4'), 'hỏng', { jobId: 'job-f', projectId: project.id, sourceId: 'src-f' });
    await expect(
      make().settleReplacement({ jobId: 'job-f', projectId: project.id, sourceId: 'src-f', replacementPath: 'x' })
    ).resolves.toEqual([]);
  });
});

describe('xem toàn bộ khu cách ly, xóa có chọn lọc, cảnh báo', () => {
  it('tổng dung lượng, từng tệp, ngày; cảnh báo khi vượt ngưỡng hoặc ổ còn dưới 10% trống', async () => {
    await make().move(writeSource('g.mp4', 3000), 'cũ', { jobId: 'j1', projectId: project.id, kind: 'outdated-source' });
    await make().move(writeSource('h.mp4', 4000), 'hỏng', { jobId: 'j2', projectId: project.id });

    const calm = await make({ statfs: () => Promise.resolve({ freeBytes: 500, totalBytes: 1000 }) }).overview();
    expect(calm.totalBytes).toBe(7000);
    expect(calm.items).toHaveLength(2);
    expect(calm.items.every((item) => item.exists && item.createdAt && item.projectName === 'Danh sách 1')).toBe(true);
    expect(calm.warnings).toEqual([]);

    const big = await make({
      statfs: () => Promise.resolve({ freeBytes: 500, totalBytes: 1000 }),
      warnBytes: 5000
    }).overview();
    expect(big.warnings.join(' ')).toContain('vượt');

    const full = await make({ statfs: () => Promise.resolve({ freeBytes: 50, totalBytes: 1000 }) }).overview();
    expect(full.warnings.join(' ')).toContain('10%');
  });

  it('mặc định ngưỡng cảnh báo là 20 GB', async () => {
    const { QUARANTINE_WARN_BYTES, QUARANTINE_WARN_FREE_RATIO } = await import('@shared/utils/quarantine-policy.js');
    expect(QUARANTINE_WARN_BYTES).toBe(20 * 1024 ** 3);
    expect(QUARANTINE_WARN_FREE_RATIO).toBe(0.1);
  });

  it('"Xóa các bản cũ đã chọn": chỉ xóa đúng tệp đã chọn, ghi nhật ký tên + dung lượng', async () => {
    const keep = await make().move(writeSource('keep.mp4'), 'cũ', { jobId: 'j1', projectId: project.id });
    const drop = await make().move(writeSource('drop.mp4', 777), 'cũ', { jobId: 'j2', projectId: project.id });
    const dropId = items.listActive().find((item) => item.quarantinePath === drop)!.id;

    const results = await make().deleteItems([dropId]);
    expect(results).toEqual([{ id: dropId, ok: true }]);
    expect(existsSync(drop)).toBe(false);
    expect(existsSync(keep)).toBe(true);
    expect(items.listActive().map((item) => item.quarantinePath)).toEqual([keep]);
    expect(logger.info).toHaveBeenCalledWith(
      'quarantine',
      'QUARANTINE_ITEM_DELETED',
      expect.stringContaining(basename(drop)),
      expect.objectContaining({ metadata: expect.objectContaining({ bytes: 777 }) as unknown })
    );
  });

  it('không bao giờ xóa tệp nằm ngoài khu cách ly dù bản ghi bị sửa', async () => {
    await make().move(writeSource('i.mp4'), 'cũ', { jobId: 'j', projectId: project.id });
    const victim = writeSource('cua-toi.mp4');
    const id = items.listActive()[0]!.id;
    database.db.prepare('UPDATE quarantine_items SET quarantine_path=? WHERE id=?').run(victim, id);

    const [result] = await make().deleteItems([id]);
    expect(result?.ok).toBe(false);
    expect(existsSync(victim)).toBe(true);
  });

  it('đổi tên danh sách: bản đã cách ly vẫn hiện đúng tên mới, vẫn xóa được qua CSDL; bản mới vào thư mục tên mới', async () => {
    const first = await make().move(writeSource('k.mp4'), 'cũ', { jobId: 'j', projectId: project.id });
    projects.update(project.id, { name: 'Đổi tên rồi' });
    const second = await make().move(writeSource('l.mp4'), 'cũ', { jobId: 'j', projectId: project.id });

    expect(basename(dirname(first))).toBe(`Danh sách 1 (${project.id.slice(0, 8)})`);
    expect(basename(dirname(second))).toBe(`Đổi tên rồi (${project.id.slice(0, 8)})`);
    const overview = await make().overview();
    expect(overview.items.map((item) => item.projectName)).toEqual(['Đổi tên rồi', 'Đổi tên rồi']);
    expect(overview.items.every((item) => item.exists)).toBe(true);

    const results = await make().deleteItems(overview.items.map((item) => item.id));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
  });

  it('không có cơ chế tự xóa: khu cách ly của danh sách vẫn còn sau overview/settle', async () => {
    const path = await make().move(writeSource('j.mp4'), 'cũ', { jobId: 'j', projectId: project.id, sourceId: 's', kind: 'outdated-source' });
    await make().settleReplacement({ jobId: 'j', projectId: project.id, sourceId: 's', replacementPath: 'x' });
    await make().overview();
    expect(existsSync(path)).toBe(true);
  });
});

describe('thư mục _quarantine cũ: chỉ báo, không di chuyển, không xóa', () => {
  it('liệt kê thư mục cũ còn tệp, bỏ qua thư mục rỗng, không đụng gì', async () => {
    const legacyTemp = join(project.tempFolder, '_quarantine');
    mkdirSync(legacyTemp, { recursive: true });
    writeFileSync(join(legacyTemp, 'old.mp4'), Buffer.alloc(321));
    const legacyOutputEmpty = join(project.outputFolder, '_quarantine');
    mkdirSync(legacyOutputEmpty, { recursive: true });

    const overview = await make().overview();
    expect(overview.legacyFolders).toEqual([{ path: legacyTemp, files: 1, bytes: 321 }]);
    expect(readdirSync(legacyTemp)).toEqual(['old.mp4']);
    expect(existsSync(legacyOutputEmpty)).toBe(true);
  });
});
