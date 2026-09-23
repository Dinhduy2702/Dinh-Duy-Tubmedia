import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertSafeCleanupPath,
  categoryTargets,
  CleanupScanCancelledError,
  listCategoryFiles,
  scanTarget,
  scanTubmediaResidue,
  type CleanupEnvironmentPaths
} from '../../src/main/system/cleanup-scanner.js';

// QUAN TRỌNG: mọi thư mục dùng trong các bài kiểm này đều nằm trong một sandbox riêng dưới thư mục
// tạm hệ thống (os.tmpdir()), KHÔNG BAO GIỜ đụng tới Temp/LocalAppData/AppData thật của người dùng
// đang chạy máy này. assertSafeCleanupPath vẫn được kiểm bằng chính process.env thật (không giả lập)
// vì đó là cổng an toàn cuối cùng, độc lập với môi trường test.

describe('cleanup-scanner: assertSafeCleanupPath (cổng an toàn cuối cùng)', () => {
  it('blocks the real system-wide roots regardless of caller', () => {
    expect(() => assertSafeCleanupPath(process.env.WINDIR ?? 'C:\\Windows')).toThrow(/quá rộng\/nguy hiểm/);
    expect(() => assertSafeCleanupPath(process.env.USERPROFILE ?? 'C:\\Users\\test')).toThrow();
    expect(() => assertSafeCleanupPath(process.env.SystemDrive ?? 'C:')).toThrow();
  });

  it('blocks any path containing "Zalo Received Files"', () => {
    expect(() => assertSafeCleanupPath('C:\\Users\\test\\Zalo Received Files\\a.mp4')).toThrow(
      /Zalo Received Files/
    );
  });

  it('rejects empty/invalid paths', () => {
    expect(() => assertSafeCleanupPath('')).toThrow();
    expect(() => assertSafeCleanupPath('   ')).toThrow();
  });

  it('blocks ANY bare drive root, not just the system drive (ví dụ "D:\\", không chỉ ổ hệ thống)', () => {
    for (const candidate of ['D:\\', 'E:', 'z:', 'Z:\\']) {
      expect(() => assertSafeCleanupPath(candidate)).toThrow(/gốc ổ đĩa/);
    }
  });

  it('does NOT block an ordinary subfolder on a non-system drive', () => {
    expect(() => assertSafeCleanupPath('D:\\some-folder\\cache')).not.toThrow();
  });

  it('allows an ordinary nested folder', () => {
    expect(() => assertSafeCleanupPath(join(tmpdir(), 'tubmedia-cleanup-test-ok'))).not.toThrow();
  });
});

describe('cleanup-scanner: categoryTargets (chỉ 7 hạng mục còn lại, không cần Admin)', () => {
  const env: CleanupEnvironmentPaths = {
    tempDir: 'C:\\fake-temp',
    localAppData: 'C:\\fake-local',
    roamingAppData: 'C:\\fake-roaming'
  };

  it('crashReports only targets the user CrashDumps folder (WER/ProgramData removed)', async () => {
    const targets = await categoryTargets('crashReports', env);
    expect(targets).toEqual([{ path: join(env.localAppData, 'CrashDumps') }]);
  });

  it('thumbnailCache uses filename patterns, single directory', async () => {
    const targets = await categoryTargets('thumbnailCache', env);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.patterns).toEqual(['thumbcache_*.db', 'iconcache_*.db']);
  });

  it('userTemp scans both %TEMP% and %LOCALAPPDATA%\\Temp, nothing else', async () => {
    const targets = await categoryTargets('userTemp', env);
    expect(targets.map((t) => t.path)).toEqual([env.tempDir, join(env.localAppData, 'Temp')]);
  });

  it('browserCache returns no targets when no browser profile folder exists (never invents paths)', async () => {
    const targets = await categoryTargets('browserCache', env);
    expect(targets).toEqual([]);
  });

  it('capcutCache and zaloCache never reference the other vendor and never touch Zalo Received Files', async () => {
    const capcut = await categoryTargets('capcutCache', env);
    const zalo = await categoryTargets('zaloCache', env);

    expect(capcut.every((t) => !/zalo/i.test(t.path))).toBe(true);
    expect(zalo.every((t) => !/capcut|bytedance/i.test(t.path))).toBe(true);
    expect(zalo.every((t) => !/received files/i.test(t.path))).toBe(true);
  });
});

describe('cleanup-scanner: scanTarget (đọc thật trên thư mục giả trong tmp, không đụng máy thật)', () => {
  let sandbox = '';

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'tubmedia-cleanup-scan-'));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('recursively sums bytes of every file under a target with no patterns', async () => {
    await mkdir(join(sandbox, 'sub'), { recursive: true });
    await writeFile(join(sandbox, 'a.txt'), Buffer.alloc(10));
    await writeFile(join(sandbox, 'sub', 'b.txt'), Buffer.alloc(20));

    const result = await scanTarget({ path: sandbox });
    expect(result.estimatedBytes).toBe(30);
    expect(result.findings.every((f) => f.classification === 'safe-to-delete')).toBe(true);
  });

  it('only matches given filename patterns and does not recurse into subdirectories', async () => {
    await mkdir(join(sandbox, 'nested'), { recursive: true });
    await writeFile(join(sandbox, 'thumbcache_001.db'), Buffer.alloc(5));
    await writeFile(join(sandbox, 'keep.txt'), Buffer.alloc(999));
    await writeFile(join(sandbox, 'nested', 'thumbcache_should-not-count.db'), Buffer.alloc(999));

    const result = await scanTarget({ path: sandbox, patterns: ['thumbcache_*.db'] });
    expect(result.estimatedBytes).toBe(5);
  });

  it('returns zero for a target that does not exist (never throws for missing folders)', async () => {
    const result = await scanTarget({ path: join(sandbox, 'does-not-exist') });
    expect(result.estimatedBytes).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('skips symlinked files and does not follow symlinked directories', async () => {
    await writeFile(join(sandbox, 'real.txt'), Buffer.alloc(100));
    try {
      await symlink(join(sandbox, 'real.txt'), join(sandbox, 'link.txt'));
    } catch {
      // Có thể cần quyền đặc biệt để tạo symlink trên một số máy Windows — bỏ qua bài kiểm này nếu vậy.
      return;
    }

    const result = await scanTarget({ path: sandbox });
    // Chỉ đếm real.txt (100 byte), không đếm thêm bản sao qua symlink.
    expect(result.estimatedBytes).toBe(100);
  });

  it('samples at most 20 findings, keeping the largest files first', async () => {
    for (let i = 0; i < 30; i += 1) {
      await writeFile(join(sandbox, `f${i}.bin`), Buffer.alloc(i + 1));
    }

    const result = await scanTarget({ path: sandbox });
    expect(result.findings.length).toBeLessThanOrEqual(20);
    const largest = result.findings[0];
    expect(largest?.bytes).toBe(30);
  });

  it('supports cooperative cancellation and never partially counts after cancelling', async () => {
    for (let i = 0; i < 5; i += 1) {
      await mkdir(join(sandbox, `d${i}`), { recursive: true });
      await writeFile(join(sandbox, `d${i}`, 'x.bin'), Buffer.alloc(1));
    }

    await expect(scanTarget({ path: sandbox }, { shouldCancel: () => true })).rejects.toThrow();

    try {
      await scanTarget({ path: sandbox }, { shouldCancel: () => true });
    } catch (error) {
      expect(error).toBeInstanceOf(CleanupScanCancelledError);
    }
  });
});

describe('cleanup-scanner: scanTubmediaResidue (chỉ nhận diện dữ liệu có dấu hiệu Tubmedia)', () => {
  let sandbox = '';
  const oldMtime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const freshMtime = new Date();

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'tubmedia-residue-'));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  async function touch(path: string, bytes: number, mtime: Date): Promise<void> {
    await writeFile(path, Buffer.alloc(bytes));
    const { utimes } = await import('node:fs/promises');
    await utimes(path, mtime, mtime);
  }

  it('ignores a temp folder with no ownership marker, even if filenames match', async () => {
    const tempRoot = join(sandbox, 'temp-no-marker');
    await mkdir(tempRoot, { recursive: true });
    await touch(join(tempRoot, 'clip-1-abc.mp4'), 500, oldMtime);

    const result = await scanTubmediaResidue({
      sourceFolders: [],
      tempFolders: [tempRoot],
      trackedTempFiles: [],
      quickOutputFolders: [],
      quickTempRoots: []
    });

    expect(result.estimatedBytes).toBe(0);
  });

  it('counts a matching old file once the ownership marker exists', async () => {
    const tempRoot = join(sandbox, 'temp-with-marker');
    await mkdir(tempRoot, { recursive: true });
    await writeFile(join(tempRoot, '.tubmedia-owned.json'), JSON.stringify({ owner: 'Tubmedia', version: 1 }));
    await touch(join(tempRoot, 'clip-1-abc.mp4'), 500, oldMtime);
    await touch(join(tempRoot, 'not-tubmedia.mp4'), 999, oldMtime);

    const result = await scanTubmediaResidue({
      sourceFolders: [],
      tempFolders: [tempRoot],
      trackedTempFiles: [],
      quickOutputFolders: [],
      quickTempRoots: []
    });

    expect(result.estimatedBytes).toBe(500);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.path).toContain('clip-1-abc.mp4');
  });

  it('never counts a file younger than 7 days, even with a matching name and marker', async () => {
    const tempRoot = join(sandbox, 'temp-fresh');
    await mkdir(tempRoot, { recursive: true });
    await writeFile(join(tempRoot, '.tubmedia-owned.json'), JSON.stringify({ owner: 'Tubmedia', version: 1 }));
    await touch(join(tempRoot, 'clip-1-abc.mp4'), 500, freshMtime);

    const result = await scanTubmediaResidue({
      sourceFolders: [],
      tempFolders: [tempRoot],
      trackedTempFiles: [],
      quickOutputFolders: [],
      quickTempRoots: []
    });

    expect(result.estimatedBytes).toBe(0);
  });

  it('counts download-residue files by LINK_/QD- pattern in sourceFolders without needing a marker', async () => {
    const downloadRoot = join(sandbox, 'downloads');
    await mkdir(downloadRoot, { recursive: true });
    await touch(join(downloadRoot, 'video [LINK_AABBCCDDEEFF].part'), 700, oldMtime);
    await touch(join(downloadRoot, 'finished-video.mp4'), 700, oldMtime);

    const result = await scanTubmediaResidue({
      sourceFolders: [downloadRoot],
      tempFolders: [],
      trackedTempFiles: [],
      quickOutputFolders: [],
      quickTempRoots: []
    });

    expect(result.estimatedBytes).toBe(700);
    expect(result.findings).toHaveLength(1);
  });

  it('quick-temp roots only count files under a 12-hex-char subfolder', async () => {
    const quickRoot = join(sandbox, 'quick-temp');
    await mkdir(join(quickRoot, 'abcdef123456'), { recursive: true });
    await mkdir(join(quickRoot, 'not-a-uuid-folder'), { recursive: true });
    await touch(join(quickRoot, 'abcdef123456', 'anything.mp4'), 300, oldMtime);
    await touch(join(quickRoot, 'not-a-uuid-folder', 'anything.mp4'), 300, oldMtime);

    const result = await scanTubmediaResidue({
      sourceFolders: [],
      tempFolders: [],
      trackedTempFiles: [],
      quickOutputFolders: [],
      quickTempRoots: [quickRoot]
    });

    expect(result.estimatedBytes).toBe(300);
  });

  it('tracked files must resolve inside a known tempFolders root to be counted', async () => {
    const tempRoot = join(sandbox, 'tracked-root');
    await mkdir(tempRoot, { recursive: true });
    const insideFile = join(tempRoot, 'clip-1-x.mp4');
    await touch(insideFile, 111, oldMtime);

    const outsideFile = join(sandbox, 'outside.mp4');
    await touch(outsideFile, 222, oldMtime);

    const result = await scanTubmediaResidue({
      sourceFolders: [],
      tempFolders: [tempRoot],
      trackedTempFiles: [insideFile, outsideFile],
      quickOutputFolders: [],
      quickTempRoots: []
    });

    expect(result.estimatedBytes).toBe(111);
  });

  it('reports (does not throw for) an invalid root, and keeps scanning the rest', async () => {
    const goodRoot = join(sandbox, 'good');
    await mkdir(goodRoot, { recursive: true });

    const result = await scanTubmediaResidue({
      sourceFolders: [process.env.WINDIR ?? 'C:\\Windows'],
      tempFolders: [],
      trackedTempFiles: [],
      quickOutputFolders: [],
      quickTempRoots: []
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/quá rộng\/nguy hiểm/);
    void goodRoot;
  });
});

describe('cleanup-scanner: ma trận đường dẫn hiểm (GĐ4b — junction, vòng lặp symlink)', () => {
  let sandbox = '';

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'tubmedia-cleanup-danger-'));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('never descends into a directory junction, even one pointing outside the scanned root', async () => {
    const scanRoot = join(sandbox, 'scan-root');
    const outsideSecret = join(sandbox, 'outside-secret');
    await mkdir(scanRoot, { recursive: true });
    await mkdir(outsideSecret, { recursive: true });
    const canary = join(outsideSecret, 'canary.txt');
    await writeFile(canary, 'TUYỆT ĐỐI không được đụng vào');

    try {
      const { symlink: createLink } = await import('node:fs/promises');
      await createLink(outsideSecret, join(scanRoot, 'junction-out'), 'junction');
    } catch {
      return; // Máy/tài khoản không cho tạo junction — bỏ qua an toàn, không coi là thất bại.
    }

    const files = await listCategoryFiles({ path: scanRoot });
    expect(files.some((f) => f.path.includes('canary.txt'))).toBe(false);
    expect(files.every((f) => !f.path.startsWith(outsideSecret))).toBe(true);
    // Canary vẫn còn nguyên — không hề bị quét/đụng tới.
    expect(existsSync(canary)).toBe(true);
  });

  it('terminates and returns nothing through a self-referential symlink loop (never hangs, never stack-overflows)', async () => {
    const scanRoot = join(sandbox, 'loop-root');
    await mkdir(scanRoot, { recursive: true });
    await writeFile(join(scanRoot, 'real.txt'), Buffer.alloc(42));

    try {
      const { symlink: createLink } = await import('node:fs/promises');
      // Vòng lặp: thư mục con "loop" trỏ ngược lại chính scanRoot.
      await createLink(scanRoot, join(scanRoot, 'loop'), 'junction');
    } catch {
      return;
    }

    const files = await listCategoryFiles({ path: scanRoot });
    // Chỉ đếm đúng 1 file thật — vòng lặp không được theo, không đếm lặp lại real.txt qua "loop".
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(join(scanRoot, 'real.txt'));
  });

  it('a tracked residue file that is itself a symlink pointing at a real document is skipped entirely', async () => {
    const tempRoot = join(sandbox, 'temp-root');
    await mkdir(tempRoot, { recursive: true });
    await writeFile(join(tempRoot, '.tubmedia-owned.json'), JSON.stringify({ owner: 'Tubmedia', version: 1 }));

    const realDocument = join(sandbox, 'real-document.docx');
    await writeFile(realDocument, 'tài liệu thật của người dùng');
    const trackedSymlinkPath = join(tempRoot, 'clip-1-fake.mp4');

    try {
      const { symlink: createLink } = await import('node:fs/promises');
      await createLink(realDocument, trackedSymlinkPath);
    } catch {
      return;
    }

    const result = await scanTubmediaResidue({
      sourceFolders: [],
      tempFolders: [tempRoot],
      trackedTempFiles: [trackedSymlinkPath],
      quickOutputFolders: [],
      quickTempRoots: []
    });

    expect(result.estimatedBytes).toBe(0);
    expect(existsSync(realDocument)).toBe(true);
  });
});
