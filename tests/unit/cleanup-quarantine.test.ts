import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUARANTINE_RETENTION_DAYS, QuarantineStore } from '../../src/main/system/cleanup-quarantine.js';
import { copyFileVerified } from '../../src/main/system/cleanup-scanner.js';

// Toàn bộ bài kiểm chỉ dùng thư mục giả trong os.tmpdir() — không bao giờ đụng thư mục thật của người
// dùng. Một bài kiểm CỐ Ý trỏ vào %WINDIR% thật để xác nhận assertSafeCleanupPath (gọi bên trong
// quarantineFile) chặn TRƯỚC khi làm bất kỳ điều gì — không tạo/xóa/di chuyển gì thật ở đó.

describe('QuarantineStore', () => {
  let sandbox = '';
  let store: QuarantineStore;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'tubmedia-quarantine-'));
    store = new QuarantineStore(join(sandbox, 'quarantine'));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('listActive() on a fresh store (no manifest file yet) returns an empty array, never throws', async () => {
    await expect(store.listActive()).resolves.toEqual([]);
  });

  it('quarantineFile() moves a real file, removes the original, and records a correct manifest entry', async () => {
    const original = join(sandbox, 'source', 'a.txt');
    await mkdir(join(sandbox, 'source'), { recursive: true });
    await writeFile(original, Buffer.alloc(123));

    const outcome = await store.quarantineFile(original, 'userTemp', 'run-1');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(existsSync(original)).toBe(false);
    expect(outcome.entry.bytes).toBe(123);
    expect(outcome.entry.originalPath).toBe(original);
    expect(outcome.entry.runId).toBe('run-1');
    expect(outcome.entry.categoryId).toBe('userTemp');
    expect(outcome.entry.restoredAt).toBeNull();
    expect(outcome.entry.purgedAt).toBeNull();

    const expiresInDays = (new Date(outcome.entry.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(expiresInDays).toBeGreaterThan(QUARANTINE_RETENTION_DAYS - 1);
    expect(expiresInDays).toBeLessThanOrEqual(QUARANTINE_RETENTION_DAYS);

    const active = await store.listActive();
    expect(active).toEqual([outcome.entry]);
  });

  it('quarantineFile() never touches a real blocked system path (validation runs before any fs mutation)', async () => {
    const blocked = process.env.WINDIR ?? 'C:\\Windows';
    const outcome = await store.quarantineFile(blocked, 'userTemp', 'run-1');

    expect(outcome.ok).toBe(false);
    // Không có file cách ly nào được tạo ra vì lời gọi này.
    expect(await store.listActive()).toEqual([]);
    expect(existsSync(blocked)).toBe(true);
  });

  it('quarantineFile() rejects a bare drive root even when nothing else about it looks unsafe', async () => {
    const outcome = await store.quarantineFile('D:\\', 'userTemp', 'run-1');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/gốc ổ đĩa/);
  });

  it('quarantineFile() reports a clear reason (not a crash) when the file no longer exists', async () => {
    const outcome = await store.quarantineFile(join(sandbox, 'never-existed.txt'), 'userTemp', 'run-1');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/Không tìm thấy/);
  });

  it('quarantineFile() rejects a directory (not a regular file)', async () => {
    const directory = join(sandbox, 'a-directory');
    await mkdir(directory, { recursive: true });
    const outcome = await store.quarantineFile(directory, 'userTemp', 'run-1');
    expect(outcome.ok).toBe(false);
    expect(existsSync(directory)).toBe(true);
  });

  it('two files with the same basename from different folders never collide in the quarantine store', async () => {
    await mkdir(join(sandbox, 'dir1'), { recursive: true });
    await mkdir(join(sandbox, 'dir2'), { recursive: true });
    const fileA = join(sandbox, 'dir1', 'same-name.txt');
    const fileB = join(sandbox, 'dir2', 'same-name.txt');
    await writeFile(fileA, 'A');
    await writeFile(fileB, 'B');

    const outcomeA = await store.quarantineFile(fileA, 'userTemp', 'run-1');
    const outcomeB = await store.quarantineFile(fileB, 'userTemp', 'run-1');
    expect(outcomeA.ok && outcomeB.ok).toBe(true);
    if (!outcomeA.ok || !outcomeB.ok) return;

    const restored = await store.restore([outcomeA.entry.id, outcomeB.entry.id]);
    expect(restored.every((r) => r.ok)).toBe(true);
    expect(await readFile(fileA, 'utf8')).toBe('A');
    expect(await readFile(fileB, 'utf8')).toBe('B');
  });

  it('restore() recreates a missing parent directory before writing the file back', async () => {
    const original = join(sandbox, 'will-be-removed', 'nested', 'file.txt');
    await mkdir(join(sandbox, 'will-be-removed', 'nested'), { recursive: true });
    await writeFile(original, 'giữ nguyên nội dung');

    const outcome = await store.quarantineFile(original, 'userTemp', 'run-1');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Xóa hẳn thư mục cha (mô phỏng thư mục gốc bị dọn/đổi tên sau khi đã cách ly).
    await rm(join(sandbox, 'will-be-removed'), { recursive: true, force: true });

    const [result] = await store.restore([outcome.entry.id]);
    expect(result?.ok).toBe(true);
    expect(existsSync(original)).toBe(true);
    expect(await readFile(original, 'utf8')).toBe('giữ nguyên nội dung');
  });

  it('restore() on an unknown id is a no-op result, never throws', async () => {
    const results = await store.restore(['00000000-0000-4000-8000-000000000000']);
    expect(results).toEqual([]);
  });

  it('restore() on an already-restored entry reports it clearly instead of re-restoring', async () => {
    const original = join(sandbox, 'twice.txt');
    await writeFile(original, 'x');
    const outcome = await store.quarantineFile(original, 'userTemp', 'run-1');
    if (!outcome.ok) throw new Error('expected ok');

    await store.restore([outcome.entry.id]);
    const second = await store.restore([outcome.entry.id]);
    expect(second[0]?.id).toBe(outcome.entry.id);
    expect(second[0]?.ok).toBe(false);
    expect(second[0]?.message).toMatch(/đã được hoàn tác/);
  });

  it('purgeExpired() is a safe no-op on an empty store', async () => {
    await expect(store.purgeExpired()).resolves.toEqual({ purged: 0 });
  });
});

describe('copyFileVerified (dùng khi khác ổ đĩa — EXDEV)', () => {
  let sandbox = '';

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'tubmedia-copy-verified-'));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('copies a real file byte-for-byte and leaves the source untouched', async () => {
    const source = join(sandbox, 'src.bin');
    const destination = join(sandbox, 'dst.bin');
    const content = Buffer.from('nội dung nhị phân giả lập' + 'x'.repeat(500));
    await writeFile(source, content);

    await copyFileVerified(source, destination);

    expect(existsSync(source)).toBe(true);
    expect((await readFile(destination)).equals(content)).toBe(true);
  });
});
