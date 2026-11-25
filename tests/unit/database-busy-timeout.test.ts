import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dbSource = readFileSync(resolve(process.cwd(), 'src/main/database/database.ts'), 'utf8');

describe('AppDatabase — busy_timeout trước WAL và timeout khi mở kết nối (#5)', () => {
  it('mở DatabaseSync với tùy chọn { timeout: 5000 }', () => {
    expect(dbSource).toMatch(/new DatabaseSync\s*\(\s*path\s*,\s*\{\s*timeout:\s*5000\s*\}\s*\)/);
  });

  it('đặt PRAGMA busy_timeout = 5000 TRƯỚC PRAGMA journal_mode = WAL', () => {
    const busyIdx = dbSource.indexOf('PRAGMA busy_timeout = 5000');
    const walIdx = dbSource.indexOf('PRAGMA journal_mode = WAL');
    expect(busyIdx).toBeGreaterThan(-1);
    expect(walIdx).toBeGreaterThan(-1);
    expect(busyIdx).toBeLessThan(walIdx);
  });
});
