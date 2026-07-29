# Hotfix v0.5.1 — CPU tự động và NVENC fallback

Bản này xử lý máy có FFmpeg mới nhưng driver NVIDIA chưa đáp ứng NVENC API mà FFmpeg yêu cầu.

## Hành vi mới

- `CPU tự động` là encoder mặc định của toàn bộ Quality Profile tích hợp.
- H.264 dùng `libx264`; HEVC dùng `libx265`.
- Resource Profile tích hợp và profile đề xuất theo máy đặt `GPU jobs = 0`.
- Health Check chạy encode NVENC thật, không chỉ đọc danh sách encoder.
- Khi NVENC có trong FFmpeg nhưng runtime thất bại, giao diện hiển thị trạng thái dễ hiểu.
- Nếu người dùng ép NVENC nhưng Health Check không đạt, ứng dụng tự dùng CPU.
- Nếu NVENC vượt Health Check nhưng lỗi giữa tác vụ, backend tự chạy lại một lần bằng CPU.
- Log ghi rõ encoder thực tế nhưng không đổ lỗi kỹ thuật dài lên giao diện chính.

## Cấu hình khuyến nghị cho máy 72 logical CPU / 128 GB RAM

- Quality: Smart Merge Highest Quality hoặc 1080p High Quality Compatible.
- Encoder: CPU tự động.
- FFmpeg threads: 8.
- Normalize workers: 1.
- Process priority: Below Normal.
- GPU jobs: 0.

## Kiểm tra sau khi chép patch

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run build
npm.cmd run dev
```

Trong ứng dụng chạy `Công cụ → Health Check`. FFmpeg phải hiển thị `CPU tự động`, `libx264` và `libx265`. Nếu driver không tương thích, NVENC sẽ hiện là không khả dụng nhưng workflow vẫn sẵn sàng.
