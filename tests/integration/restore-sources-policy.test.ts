import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => tmpdir() }
}));

import { AppDatabase } from '@main/database/database.js';
import { BackupService } from '@main/backups/backup-service.js';
import type { Logger } from '@main/logging/logger.js';

let folder = '';
const databases: AppDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

function openDatabase(name: string): AppDatabase {
  if (!folder) folder = mkdtempSync(join(tmpdir(), 'tubmedia-sources-it-'));
  const database = new AppDatabase(join(folder, name));
  databases.push(database);
  return database;
}

function insertSource(database: AppDatabase, id: string, originalUrl: string, normalizedUrl: string): void {
  const now = new Date().toISOString();
  database.db
    .prepare(
      `INSERT INTO media_sources(id,identity,original_url,normalized_url,platform,extractor_key,media_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    )
    .run(id, `identity-${id}`, originalUrl, normalizedUrl, 'generic', 'generic', id, now, now);
}

function urls(database: AppDatabase, id: string): { original_url: string; normalized_url: string } {
  return database.db
    .prepare('SELECT original_url,normalized_url FROM media_sources WHERE id=?')
    .get(id) as { original_url: string; normalized_url: string };
}

describe('BackupService.restore: original_url của nguồn video từ backup', () => {
  it('vô hiệu hóa URL giống tùy chọn/không phải web, giữ nguyên URL hợp lệ', () => {
    const backup = openDatabase('backup.sqlite');
    insertSource(backup, 'ok', 'https://example.com/video-1', 'https://example.com/video-1');
    insertSource(backup, 'exec', '--exec calc.exe', 'https://example.com/video-2');
    insertSource(backup, 'file', 'file:///C:/Windows/win.ini', 'file:///C:/Windows/win.ini');
    insertSource(backup, 'space', 'https://example.com/a --exec x', 'https://example.com/video-3');
    backup.checkpoint();
    backup.close();
    databases.splice(databases.indexOf(backup), 1);

    const target = openDatabase('current.sqlite');
    const warnings: string[] = [];
    const logger = {
      info: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      warn: (_module: string, code: string) => {
        warnings.push(code);
      }
    } as unknown as Logger;
    new BackupService(target, join(folder, 'backups'), logger).restore(join(folder, 'backup.sqlite'), 'merge');

    expect(urls(target, 'ok')).toEqual({
      original_url: 'https://example.com/video-1',
      normalized_url: 'https://example.com/video-1'
    });
    // original_url sai được thay bằng normalized_url hợp lệ.
    expect(urls(target, 'exec')).toEqual({
      original_url: 'https://example.com/video-2',
      normalized_url: 'https://example.com/video-2'
    });
    expect(urls(target, 'space').original_url).toBe('https://example.com/video-3');
    // Cả hai đều sai thì để trống: tác vụ sẽ báo lỗi thay vì chạy.
    expect(urls(target, 'file')).toEqual({ original_url: '', normalized_url: '' });
    expect(warnings).toContain('BACKUP_SOURCES_SANITIZED');
  });

  it('không đụng vào nguồn video đã có sẵn trên máy nhưng không thuộc backup', () => {
    const backup = openDatabase('backup.sqlite');
    insertSource(backup, 'ok', 'https://example.com/video-1', 'https://example.com/video-1');
    backup.checkpoint();
    backup.close();
    databases.splice(databases.indexOf(backup), 1);

    const target = openDatabase('current.sqlite');
    insertSource(target, 'legacy', 'ftp://cu.example.com/x', 'ftp://cu.example.com/x');
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger;
    new BackupService(target, join(folder, 'backups'), logger).restore(join(folder, 'backup.sqlite'), 'merge');

    expect(urls(target, 'legacy').original_url).toBe('ftp://cu.example.com/x');
    expect(urls(target, 'ok').original_url).toBe('https://example.com/video-1');
  });
});
