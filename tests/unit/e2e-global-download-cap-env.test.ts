import { describe, expect, it } from 'vitest';
import { readDevelopmentEnvironment } from '../../src/main/runtime/development-environment.js';

// 2026-10-26: TUBMEDIA_E2E_GLOBAL_DOWNLOAD_CAP chỉ để bài e2e "bắt đầu dần" không phụ thuộc cấu hình máy chạy (máy GitHub yếu).
describe('biến ghim trần tổng video cho bài e2e', () => {
  it('bản đã cài bỏ qua hoàn toàn — trần luôn tự dò theo máy người dùng', () => {
    const env = { TUBMEDIA_E2E: '1', TUBMEDIA_E2E_GLOBAL_DOWNLOAD_CAP: '8' };
    expect(readDevelopmentEnvironment(env, true).e2eGlobalDownloadCap).toBeUndefined();
  });

  it('chạy từ mã nguồn: chỉ có tác dụng khi bật chế độ e2e, giới hạn 1–32', () => {
    expect(readDevelopmentEnvironment({ TUBMEDIA_E2E_GLOBAL_DOWNLOAD_CAP: '8' }, false).e2eGlobalDownloadCap).toBeUndefined();
    expect(readDevelopmentEnvironment({ TUBMEDIA_E2E: '1', TUBMEDIA_E2E_GLOBAL_DOWNLOAD_CAP: '8' }, false).e2eGlobalDownloadCap).toBe(8);
    expect(readDevelopmentEnvironment({ TUBMEDIA_E2E: '1', TUBMEDIA_E2E_GLOBAL_DOWNLOAD_CAP: '500' }, false).e2eGlobalDownloadCap).toBe(32);
    expect(readDevelopmentEnvironment({ TUBMEDIA_E2E: '1', TUBMEDIA_E2E_GLOBAL_DOWNLOAD_CAP: 'abc' }, false).e2eGlobalDownloadCap).toBeUndefined();
  });
});
