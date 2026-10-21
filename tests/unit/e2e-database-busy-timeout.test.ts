import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Lượt Publish 1.7.1 (run 39557022201, 2026-10-21) trượt ở e2e "Phần B thông báo": ngay sau khi đóng app, bài kiểm mở
// thẳng studio.sqlite để ghi thì gặp "database is locked" — trên máy GitHub, Defender (MsMpEng.exe) đang giữ tệp.
// Bài kiểm phải chờ tệp hết bị khoá (busy timeout của SQLite) thay vì trượt ngay.
describe('e2e "Phần B thông báo" chịu được lúc tệp CSDL bị khoá', () => {
  const source = readFileSync(join(process.cwd(), 'tests/e2e/app.spec.ts'), 'utf8');
  const start = source.indexOf("test('Phần B thông báo:");
  const testBody = source.slice(start, source.indexOf('\ntest(', start + 1));

  it('có hàm mở CSDL chờ tối đa 30 giây khi tệp bị khoá', () => {
    expect(source).toMatch(
      /function openStudioDatabase\(userDataDirectory: string\): DatabaseSync \{\s*return new DatabaseSync\(path\.join\(userDataDirectory, 'database', 'studio\.sqlite'\), \{ timeout: 30_000 \}\);/
    );
  });

  it('bài kiểm chỉ mở CSDL qua hàm đó, không còn mở thẳng (không chờ)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(testBody).not.toContain('new DatabaseSync(');
    expect(testBody.match(/openStudioDatabase\(userDataDirectory\)/g)?.length).toBe(3);
  });
});
