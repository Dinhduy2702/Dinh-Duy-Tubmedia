import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '@main/database/database.js';
import { ProjectRepository } from '@main/database/repositories/project-repository.js';
import { QueueRepository } from '@main/database/repositories/queue-repository.js';
import { logMigrationReports } from '@main/database/migration-report.js';

let folder = '';
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
  folder = '';
});

describe('migration: đặt lại bộ đếm lượt thử theo cách đếm mới', () => {
  it('chạy đúng một lần, chỉ cho tác vụ chưa hoàn tất, và báo số tác vụ đã đặt lại', () => {
    folder = mkdtempSync(join(tmpdir(), 'tubmedia-migration-'));
    const path = join(folder, 'db.sqlite');

    // Dựng CSDL "bản cũ": đủ schema hiện tại nhưng chưa ghi nhận migration đặt lại bộ đếm.
    const first = new AppDatabase(path);
    const projects = new ProjectRepository(first.db);
    const queue = new QueueRepository(first.db);
    const project = projects.create({
      name: 'cũ',
      sourceFolder: join(folder, 's'),
      tempFolder: join(folder, 't'),
      outputFolder: join(folder, 'o'),
      finalFileName: 'x',
      qualityProfileId: 'q',
      resourceProfileId: 'r'
    });
    const make = (status: string, attempts: number): string => {
      const job = queue.create({ projectId: project.id, type: 'download', input: {} });
      first.db.prepare('UPDATE queue_jobs SET status=?, attempts=? WHERE id=?').run(status, attempts, job.id);
      return job.id;
    };
    const unfinished = ['pending', 'paused', 'interrupted', 'downloading', 'retrying'].map((s) => make(s, 3));
    const finished = ['completed', 'skipped', 'cancelled', 'failed'].map((s) => make(s, 3));
    first.db.prepare("DELETE FROM schema_migrations WHERE name='reset_attempts_count_failures_only'").run();
    first.close();

    const second = new AppDatabase(path);
    const report = second.migrationReports.find((item) => item.name === 'reset_attempts_count_failures_only');
    expect(report?.changes).toBe(unfinished.length);
    const read = (id: string): number =>
      (second.db.prepare('SELECT attempts FROM queue_jobs WHERE id=?').get(id) as { attempts: number }).attempts;
    for (const id of unfinished) expect(read(id)).toBe(0);
    for (const id of finished) expect(read(id)).toBe(3);

    const logger = { info: vi.fn() };
    logMigrationReports(second.migrationReports, logger);
    expect(logger.info).toHaveBeenCalledWith(
      'database',
      'ATTEMPTS_COUNTER_RESET',
      expect.stringContaining(`${unfinished.length} tác vụ`),
      expect.anything()
    );
    second.db.prepare('UPDATE queue_jobs SET attempts=2 WHERE id=?').run(unfinished[0]!);
    second.close();

    // Mở lần nữa: migration không chạy lại.
    const third = new AppDatabase(path);
    expect(third.migrationReports).toHaveLength(0);
    expect((third.db.prepare('SELECT attempts FROM queue_jobs WHERE id=?').get(unfinished[0]!) as { attempts: number }).attempts).toBe(2);
    third.close();
  });
});
