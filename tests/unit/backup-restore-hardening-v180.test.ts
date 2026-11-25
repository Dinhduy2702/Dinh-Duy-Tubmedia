import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

vi.mock('electron', () => ({
  app: { getVersion: () => '1.7.8' }
}));

import { AppDatabase } from '../../src/main/database/database.js';
import { BackupService } from '../../src/main/backups/backup-service.js';
import type { Logger } from '../../src/main/logging/logger.js';

let root = '';

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
} as unknown as Logger;

const backupSrc = readFileSync(resolve(process.cwd(), 'src/main/backups/backup-service.ts'), 'utf8');
const ipcSrc = readFileSync(resolve(process.cwd(), 'src/main/ipc/register-ipc.ts'), 'utf8');

function insertProject(db: AppDatabase, id: string, name: string): void {
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO projects(id,name,code,description,status,source_folder,temp_folder,output_folder,quarantine_folder,final_file_name,quality_profile_id,resource_profile_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, name, null, '', 'idle', 'C:\\s', 'C:\\t', 'C:\\o', 'C:\\q', 'out.mp4', 'q1', 'r1', now, now);
}

function insertItem(db: AppDatabase, id: string, projectId: string, position: number): void {
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO project_items(id,project_id,batch_id,position,original_text,url,normalized_url,platform,extractor_key,media_id,source_id,timestamp_start,timestamp_end,note,audio_mode,validity,warnings_json,errors_json,clip_file,enabled,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id,
      projectId,
      null,
      position,
      'https://example.com/v',
      'https://example.com/v',
      'https://example.com/v',
      'youtube',
      'youtube',
      id,
      null,
      null,
      null,
      '',
      'keep',
      'valid',
      '[]',
      '[]',
      null,
      1,
      now,
      now
    );
}

describe('BackupService — merge không kích hoạt ON DELETE CASCADE, wal_checkpoint(PASSIVE), quarantine_items & app_extra (#9)', () => {
  it('merge restore giữ nguyên project_items hiện có (không kích hoạt ON DELETE CASCADE), khôi phục quarantine_items và làm sạch app_extra', () => {
    root = mkdtempSync(join(tmpdir(), 'tubmedia-backup-merge-'));
    const backupDbPath = join(root, 'backup.sqlite');
    const mainDbPath = join(root, 'main.sqlite');

    const backupDb = new AppDatabase(backupDbPath);
    insertProject(backupDb, 'proj-1', 'Dự án từ backup');
    insertItem(backupDb, 'item-from-backup', 'proj-1', 1);
    backupDb.db
      .prepare(
        `INSERT INTO quarantine_items(id,project_id,job_id,source_id,kind,original_path,quarantine_path,bytes,reason,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`
      )
      .run('q-1', 'proj-1', null, null, 'source', 'C:\\a.mp4', 'C:\\q\\a.mp4', 1024, 'corrupt', new Date().toISOString());
    backupDb.db
      .prepare(`INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)`)
      .run('app_extra', JSON.stringify({ ytdlpPath: '\\\\evil\\share\\yt-dlp.exe', autoResumeInterruptedOnStartup: true }), new Date().toISOString());
    backupDb.close();

    const mainDb = new AppDatabase(mainDbPath);
    try {
      insertProject(mainDb, 'proj-1', 'Dự án hiện tại');
      insertItem(mainDb, 'item-local-only', 'proj-1', 2);

      const service = new BackupService(mainDb, join(root, 'backups'), silentLogger);
      service.restore(backupDbPath, 'merge');

      const itemIds = (
        mainDb.db.prepare('SELECT id FROM project_items WHERE project_id=? ORDER BY id').all('proj-1') as Array<{
          id: string;
        }>
      ).map((row) => row.id);
      expect(itemIds).toEqual(['item-from-backup', 'item-local-only']);

      const quarantineRow = mainDb.db.prepare('SELECT id FROM quarantine_items WHERE id=?').get('q-1') as
        | { id: string }
        | undefined;
      expect(quarantineRow?.id).toBe('q-1');

      const extraRow = mainDb.db.prepare("SELECT value_json FROM app_settings WHERE key='app_extra'").get() as
        | { value_json: string }
        | undefined;
      expect(extraRow?.value_json ?? '').not.toContain('\\\\evil\\share');
    } finally {
      mainDb.close();
    }
  });

  it('BackupService.create() dùng wal_checkpoint(PASSIVE) thay vì TRUNCATE', () => {
    const createStart = backupSrc.indexOf('public async create(');
    const createEnd = backupSrc.indexOf('private async pruneUpdateBackups(', createStart);
    const createBody = backupSrc.slice(createStart, createEnd);
    expect(createBody).toMatch(/checkpointPassive|wal_checkpoint\(PASSIVE\)/);
  });

  it('register-ipc.ts dừng queue và đóng database sạch trước khi relaunch sau restore', () => {
    const restoreStart = ipcSrc.indexOf('handle(IPC.backups.restore');
    const restoreBody = ipcSrc.slice(restoreStart, restoreStart + 900);
    expect(restoreBody).toContain('ctx.queue.stop(');
    expect(restoreBody).toContain('ctx.database.close()');
    expect(restoreBody.indexOf('ctx.database.close()')).toBeLessThan(restoreBody.indexOf('app.relaunch'));
  });
});
