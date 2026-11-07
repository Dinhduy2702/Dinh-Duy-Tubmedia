import { describe, expect, it, vi } from 'vitest';
import { runDetached } from '../../src/main/app/detached-task.js';

// 1.7.6 việc D: lời gọi chạy ngầm (không chờ) ở index.ts:181 (requestClose khi bấm X) và main-window.ts:56/58
// (loadURL/loadFile) không bắt lỗi — bị từ chối thì thành unhandled rejection và mất ngữ cảnh lỗi.

describe('runDetached: chạy ngầm nhưng luôn bắt lỗi', () => {
  it('promise bị từ chối → gọi onError, không có unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const onError = vi.fn();
      runDetached(() => Promise.reject(new Error('database is not open')), onError);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onError).toHaveBeenCalledOnce();
      expect((onError.mock.calls[0]![0] as Error).message).toBe('database is not open');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('hàm ném lỗi ngay (đồng bộ) → cũng gọi onError, không ném ra ngoài', () => {
    const onError = vi.fn();
    expect(() =>
      runDetached(() => {
        throw new Error('sync');
      }, onError)
    ).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('onError tự ném lỗi → vẫn không thành unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      runDetached(
        () => Promise.reject(new Error('a')),
        () => {
          throw new Error('logger closed');
        }
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
