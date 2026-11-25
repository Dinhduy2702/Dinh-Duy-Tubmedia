import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../../src/shared/errors/app-errors.js';
import { friendlyIssue } from '../../src/shared/utils/ui-error.js';
import { runWithWireErrors, toWireError } from '../../src/main/ipc/wire-error.js';

/** 1.8.0: lỗi lập trình (TypeError/ReferenceError/RangeError) trong xử lý IPC = lỗi của ứng dụng → tự lưu báo cáo. */
describe('lỗi lập trình trong xử lý IPC', () => {
  it('TypeError → báo cáo tự động + câu "Lỗi của ứng dụng" (chi tiết kỹ thuật chỉ ở mục Chi tiết)', async () => {
    const reported: unknown[] = [];
    const failing = runWithWireErrors(
      () => Promise.reject(new TypeError("Cannot read properties of undefined (reading 'id')")),
      (error) => reported.push(error)
    );
    const error = (await (failing as Promise<unknown>).catch((value: unknown) => value)) as Error;
    expect(reported).toHaveLength(1);
    const issue = friendlyIssue(error);
    expect(issue.kind).toBe('app-fault');
    expect(issue.message).not.toContain('Cannot read');
    expect(issue.technical).toContain("TypeError: Cannot read properties of undefined (reading 'id')");
  });

  it('lỗi đồng bộ ReferenceError cũng được bắt', () => {
    const reported: unknown[] = [];
    expect(() =>
      runWithWireErrors(
        () => {
          throw new ReferenceError('foo is not defined');
        },
        (error) => reported.push(error)
      )
    ).toThrow(/Lỗi của ứng dụng/);
    expect(reported).toHaveLength(1);
  });

  it('lỗi nghiệp vụ và lỗi chữ thường (câu đã viết cho người dùng) KHÔNG bị coi là lỗi ứng dụng', () => {
    const reported: unknown[] = [];
    const report = (error: unknown): void => {
      reported.push(error);
    };
    expect(friendlyIssue(toWireError(new InvalidInputError('Sai đầu vào.'), report)).kind).not.toBe('app-fault');
    const plain = new Error('Đang tạo một báo cáo lỗi khác — chờ xong hoặc hủy trước.');
    expect(toWireError(plain, report)).toBe(plain);
    const parse = new SyntaxError('Unexpected token in JSON');
    expect(toWireError(parse, report)).toBe(parse);
    expect(reported).toHaveLength(0);
  });
});
