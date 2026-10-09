/** electron.vite.config.ts thay hằng này bằng mã commit lúc build (xem utils/build-commit.ts); chạy ngoài bản build → rỗng. */
declare const __TUBMEDIA_BUILD_COMMIT__: string | undefined;

export const APP_BUILD_COMMIT: string =
  typeof __TUBMEDIA_BUILD_COMMIT__ === 'string' ? __TUBMEDIA_BUILD_COMMIT__ : '';
