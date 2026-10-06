import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Mục 5 (2026-10-02) — test canh: mọi nơi ghi khu cách ly phải đi qua QuarantineService, đích do dịch vụ tự
// tính (<ổ của tệp>:\Tubmedia\quarantine\<tên (mã)>). Không còn nơi nào ghi vào <thành phẩm>\_quarantine hay
// <tạm>\_quarantine, và không còn nơi nào xóa thư mục _quarantine cũ.

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

function walk(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}

describe('khu cách ly chỉ có một chỗ', () => {
  it("không file mã nguồn nào tự ghép đường dẫn '_quarantine' (trừ nơi chỉ ĐỌC/BÁO thư mục cũ và migration cũ)", () => {
    const allowed = new Set([
      'src/main/files/legacy-quarantine.ts',
      'src/main/database/migrations.ts',
      'src/main/database/repositories/project-repository.ts'
    ]);
    const offenders = walk(join(root, 'src'))
      .map((path) => relative(root, path).replaceAll('\\', '/'))
      .filter((path) => !allowed.has(path))
      .filter((path) => /['"`]_quarantine['"`]/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('QuarantineService.move không nhận thư mục đích từ nơi gọi', () => {
    for (const path of [
      'src/main/clips/clip-engine.ts',
      'src/main/normalize/normalize-engine.ts',
      'src/main/merge/merge-engine.ts',
      'src/main/downloader/download-engine.ts'
    ]) {
      const source = read(path);
      expect(source, path).not.toMatch(/quarantine\.move\([^)]*quarantineFolder/);
      expect(source, path).not.toMatch(/quarantine\s*\.move\(\s*[\w.]+,\s*(?:project\.)?quarantineFolder/);
    }
    expect(read('src/main/merge/merge-engine.ts')).not.toMatch(/quarantineFolder: string/);
    expect(read('src/main/projects/project-service.ts')).not.toMatch(/ensureDirectory\(project\.quarantineFolder\)/);
  });

  it('bản cũ không còn bị xóa khi bản mới tải xong (giữ lại, báo "Đã giữ bản cũ")', () => {
    const engine = read('src/main/downloader/download-engine.ts');
    expect(engine).not.toMatch(/rm\(outdatedSourceBackup/);
    expect(engine).toMatch(/settleReplacement\(/);
    expect(read('src/main/queue/queue-manager.ts')).toMatch(/Đã giữ bản cũ/);
  });

  it('khởi động, hàng đợi, Workbench không dọn thư mục _quarantine cũ', () => {
    for (const path of [
      'src/main/app/app-context.ts',
      'src/main/queue/queue-manager.ts',
      'src/main/workbench/workbench-service.ts'
    ]) {
      expect(read(path), path).not.toMatch(/_quarantine/);
    }
  });
});
