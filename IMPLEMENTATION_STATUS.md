# Trạng thái triển khai 0.2.0

## Đã triển khai

- Hai list tải độc lập và chạy song song.
- Hai output folder/temp folder riêng.
- Download bằng yt-dlp, resume partial, retry, cookies, proxy, rate limit, aria2 fallback.
- Skip/dedupe theo source identity, verify ffprobe, source lock và materialize cache sang folder khác.
- Tải & ghép theo thứ tự list.
- Timestamp clip và mute.
- Smart Merge không upscale mặc định, concat-copy khi tương thích.
- Chọn target theo source thật có pixel area lớn nhất, FPS cao nhất.
- Atomic final, backup final cũ, quarantine, timeline.
- Profile tài nguyên và profile chất lượng chỉnh trên frontend.
- node:sqlite, typed IPC, Electron sandboxed preload CJS.
- Error Boundary; lỗi renderer không còn biến thành màn hình trống không thông báo.

## Kiểm tra trong môi trường tạo gói

- Quét cú pháp/transpile toàn bộ TypeScript/TSX: PASS.
- Runtime test `chooseMergeTarget`: PASS.
- Không thể chạy full `npm install/typecheck/lint/build` trong container vì npm registry timeout.

Trên Windows phải chạy `npm.cmd run check` trước khi tạo installer. Không coi bản release đạt nếu một bước trong check thất bại.
