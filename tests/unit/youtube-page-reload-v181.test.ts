import { describe, expect, it } from 'vitest';
import { classifyYtDlpFailure } from '../../src/shared/utils/download-failure.js';

const PAGE_RELOAD_ERROR =
  'WARNING: [youtube] [jsc] Error solving n challenge request using "deno" provider: Error running deno process (returncode: 1): error: Uncaught (in promise) TypeError: a.addOnDisposeCallback is not a function | ' +
  'WARNING: [youtube] DeA9bIoITQA: n challenge solving failed: Some formats may be missing. | ' +
  'ERROR: [youtube] DeA9bIoITQA: The page needs to be reloaded.';

describe('v1.8.1 — nhận diện lỗi YouTube "The page needs to be reloaded." thành bot_check (tự nghỉ chống chặn thay vì Lỗi của ứng dụng)', () => {
  it('classifyYtDlpFailure phân loại "The page needs to be reloaded." là authentication / bot_check', () => {
    expect(classifyYtDlpFailure(PAGE_RELOAD_ERROR)).toEqual({
      category: 'authentication',
      subtype: 'bot_check',
      httpStatus: null,
      retryable: false
    });
  });
});
