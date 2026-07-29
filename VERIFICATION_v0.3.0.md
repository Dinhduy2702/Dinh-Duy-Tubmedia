# Verification v0.3.0

## Đã chạy trong môi trường đóng gói

- Quét cú pháp TypeScript/TSX: 94 file, 0 lỗi cú pháp.
- Strict targeted TypeScript — backend/core thay đổi: PASS.
- Strict targeted TypeScript — renderer thay đổi: PASS.
- Runtime utility checks:
  - Workstation 72 logical CPU / 128 GB RAM → khuyến nghị 2 list, tổng 4 worker.
  - 4 list + Deep verification → 1 worker/list, tổng 2 worker.
  - Selector min/max resolution, FPS, video bitrate, audio bitrate: PASS.
  - Post-download quality validation: PASS.
- FFmpeg verification command tested with file H.264/AAC hợp lệ: hoàn tất `progress=end`.
- File MP4 bị cắt đuôi vẫn được ffprobe đọc metadata nhưng FFmpeg phát lỗi decode/partial file; Deep verifier đánh dấu lỗi vì stderr không rỗng.

## Chưa thể xác nhận trong môi trường đóng gói

Không có bộ npm dependencies thật và Electron runtime Windows trong container, nên chưa chạy được toàn bộ:

```text
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
npm.cmd run dev
```

Các bước trên bắt buộc chạy trên máy Windows sau khi chép patch. Bản vá không thêm npm dependency mới nên không cần `npm install` lại khi áp dụng lên v0.2.2 đang chạy.
