# Verification Report — v0.5.1 CPU Auto

## Đã kiểm tra trong môi trường tạo gói

- `package.json` hợp lệ, version `0.5.1`, author `Đình Duy Tubmedia`.
- 14 file TypeScript/TSX thay đổi được transpile kiểm tra cú pháp: 0 lỗi.
- Bộ chọn encoder chạy runtime với 5 trường hợp: 5 PASS.
- Built-in Quality Profile: 7 profile dùng `cpu_auto`, 1 profile dùng CPU cố định.
- Built-in Resource Profile: toàn bộ `gpuJobs = 0`.
- Health Check FFmpeg giữ marker NVENC không khả dụng và vẫn đánh dấu CPU sẵn sàng.
- Normalize Engine có hai lớp fallback: preflight fallback và retry CPU sau lỗi NVENC runtime.

## Cần xác nhận trên máy Windows

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
npm.cmd run dev
```

Sau Health Check, FFmpeg cần hiển thị `CPU tự động`, `libx264`, `libx265`. Với driver NVIDIA không tương thích, `h264_nvenc/hevc_nvenc` phải hiện không khả dụng nhưng Tải & Ghép vẫn ở trạng thái sẵn sàng.
