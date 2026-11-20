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

  it('có hàm mở CSDL chờ tối đa 30 giây và thử lại ngắn khi tệp bị khoá', () => {
    const fnStart = source.indexOf('function openStudioDatabase(userDataDirectory: string): DatabaseSync {');
    const fnEnd = source.indexOf('\n}\n', fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = source.slice(fnStart, fnEnd + 3);
    expect(fnBody).toContain("path.join(userDataDirectory, 'database', 'studio.sqlite')");
    expect(fnBody).toMatch(/new DatabaseSync\([^,]+,\s*\{\s*timeout:\s*30_000\s*\}\)/);
    expect(fnBody).toContain('database is locked|SQLITE_BUSY');
  });

  it('bài kiểm chỉ mở CSDL qua hàm đó, không còn mở thẳng (không chờ)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(testBody).not.toContain('new DatabaseSync(');
    expect(testBody.match(/openStudioDatabase\(userDataDirectory\)/g)?.length).toBe(3);
  });

  it('toàn tệp app.spec.ts chỉ có duy nhất 1 chỗ gọi new DatabaseSync( nằm trong openStudioDatabase', () => {
    const codeLines = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'));
    const directCalls = codeLines.filter((line) => line.includes('new DatabaseSync('));
    expect(directCalls).toHaveLength(1);
    expect(directCalls[0]).toMatch(/return new DatabaseSync\([^,]+,\s*\{\s*timeout:\s*30_000\s*\}\);/);
  });
});
