# Biên bản kiểm tra Tubmedia v0.8.8

## Phạm vi bản sửa

- Mỗi dòng timeline có nút Copy riêng ở đầu dòng.
- Nút chỉ sao chép mốc dạng `00:00 Ph`; không sao chép `Video_001`, tiêu đề, ghi chú hoặc đường dẫn.
- Hiển thị dung lượng video nguồn đã tải, dữ liệu xử lý tạm, video thành phẩm và tổng ba giai đoạn.
- Cảnh báo khi dung lượng thành phẩm thấp hơn 55% tổng dung lượng nguồn.
- Thêm cấu hình **Giữ nét và dung lượng gần nguồn** cho trường hợp thành phẩm thường 6–7 GB nhưng bị nén xuống 1–2 GB.
- Nếu nguồn tương thích, video được ghép bằng stream-copy.
- Nếu phải chuẩn hóa, bitrate đầu ra bám bitrate trung bình có trọng số theo thời lượng nguồn; không ép CRF 18.

## Setting đầu ra nên dùng

1. Muốn dung lượng thành phẩm gần tổng video nguồn: chọn **Giữ nét và dung lượng gần nguồn**.
2. Muốn tệp nhỏ hơn: chọn **1080p rõ nét theo code tham chiếu**; cấu hình này dùng CRF 18 nên 6–7 GB có thể giảm còn 1–2 GB.
3. Muốn giữ nguyên tuyệt đối khi các nguồn đã tương thích: chọn **Ghép thông minh chất lượng cao nhất**.
4. Không thể bảo đảm chính xác một con số GB vì dung lượng còn phụ thuộc thời lượng, bitrate, FPS, độ phân giải và mức độ phức tạp của hình ảnh.

## Kiểm thử tự động

- Asset: 2 PNG, 1 ICO và 1 SVG hợp lệ.
- TypeScript: đạt.
- ESLint: đạt, không có cảnh báo.
- Unit test: 102/102 đạt.
- SQLite integration: 11/11 đạt.
- Production build Electron main/preload/renderer: đạt.

## Cách chạy

```powershell
cd "ĐƯỜNG_DẪN\Tubmedia_v0.8.8_SOURCE"

npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Đây là source kiểm thử, chưa tạo installer Windows.
