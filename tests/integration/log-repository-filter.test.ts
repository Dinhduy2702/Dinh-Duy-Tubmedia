import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { LogRepository } from '@main/database/repositories/log-repository.js';

// Đợt 3 mục 7 (rà soát bản cài 1.5.0): lọc nhật ký phải chạy ở CSDL, không lọc trên 2000 dòng mới nhất đã tải về giao diện.

let folder = '';
const databases: AppDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function seed(): LogRepository {
  folder = mkdtempSync(join(tmpdir(), 'tubmedia-log-filter-'));
  const database = new AppDatabase(join(folder, 'app.sqlite'));
  databases.push(database);
  const repo = new LogRepository(database.db);
  const base = Date.parse('2026-10-01T00:00:00Z');
  for (let index = 0; index < 30; index += 1) {
    repo.insert({ timestamp: new Date(base + index).toISOString(), level: 'error', module: index % 2 ? 'download' : 'downloader', eventCode: 'E', message: `lỗi ${index}` });
  }
  for (let index = 0; index < 300; index += 1) {
    repo.insert({ timestamp: new Date(base + 10_000 + index).toISOString(), level: 'debug', module: 'queue', eventCode: 'D', message: `gỡ lỗi ${index}` });
  }
  return repo;
}

describe('lọc nhật ký ở CSDL', () => {
  it('lọc mức "error" trả đủ lỗi cũ dù giới hạn nhỏ hơn số dòng gỡ lỗi mới hơn', () => {
    const repo = seed();
    expect(repo.list({ level: 'error', limit: 100 })).toHaveLength(30);
  });

  it('lọc theo NHIỀU thành phần một lúc (tên tiếng Việt "Tải xuống" ứng với download + downloader)', () => {
    const repo = seed();
    const rows = repo.list({ modules: ['download', 'downloader'], limit: 100 });
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map((row) => row.module))).toEqual(new Set(['download', 'downloader']));
  });

  it('IPC nhận danh sách thành phần và chuyển xuống kho dữ liệu', () => {
    expect(readFileSync('src/shared/schemas/ipc.ts', 'utf8')).toMatch(/modules: z\.array\(/);
    expect(readFileSync('src/main/ipc/register-ipc.ts', 'utf8')).toContain('query.modules');
  });
});
