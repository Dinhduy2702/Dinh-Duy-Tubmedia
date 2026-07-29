# Biên bản kiểm tra Tubmedia v0.8.7

## Phạm vi bản sửa

- Tải danh sách có option CapCut trực tiếp SDR 1080p hoặc 1080p–2K/1440p.
- Chuẩn đầu ra CapCut: MP4, H.264 High, AAC 48 kHz tối đa 2 kênh, yuv420p 8-bit, BT.709 và tối đa 60 FPS.
- Phát hiện HDR/10-bit/BT.2020/PQ/HLG và tone-map rõ ràng; không tạo Proxy.
- Timeline mặc định chỉ xem/copy trên giao diện; user bật thì chỉ xuất `timeline.txt`, không CSV/JSON.
- Nút copy chỉ lấy các dòng ngắn dạng `00:00 Ph Video_001`.
- Chống giảm nét khi ghép bằng stream-copy video nếu chỉ audio cần chuẩn hóa.
- Preset 1080p theo đúng thông số hình của `DownloadAndConcat(2).ts`.
- Tự dọn tệp tạm không cần thiết sau khi hoàn tất và không xóa tệp tùy ý của user.

## Setting đầu ra nên dùng

1. Muốn giữ độ nét nguồn 2K/4K: **Ghép thông minh chất lượng cao nhất**.
2. Muốn giống code tham chiếu: **1080p rõ nét theo code tham chiếu**.
3. Muốn tệp tải đưa thẳng vào CapCut: vào **Cài đặt → Tải xuống → Chế độ tương thích video**, chọn 1080p hoặc 1080p–2K.
4. Không chọn **720p nhanh và nhẹ** nếu cần độ nét.

## Kiểm thử tự động

- Asset: 2 PNG, 1 ICO và 1 SVG hợp lệ.
- TypeScript: đạt.
- ESLint: đạt, không có cảnh báo.
- Unit test: 97/97 đạt.
- SQLite integration: 11/11 đạt.
- Production build Electron main/preload/renderer: đạt.

## Cách chạy

```powershell
cd "ĐƯỜNG_DẪN\Tubmedia_v0.8.7_SOURCE"

npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Đây là source kiểm thử, chưa tạo installer Windows.
