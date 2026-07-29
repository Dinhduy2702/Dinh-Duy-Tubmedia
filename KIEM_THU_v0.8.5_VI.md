# Biên bản kiểm tra Tubmedia v0.8.5

## Yêu cầu đã xử lý

- Video tải thành công không còn chạy vệt sáng trên thanh tiến trình.
- Video đã tải trước đó và được bỏ qua cũng giữ thanh tiến trình đứng yên ở 100%.
- Chỉ trạng thái thực sự đang phân tích, tải, xác minh, xử lý, ghép hoặc thử lại mới chạy hiệu ứng.
- Thanh tiến trình đang chờ, tạm dừng, hoàn tất, bỏ qua, lỗi, hủy hoặc gián đoạn đều đứng yên.
- Quy tắc được áp dụng tại trang Tiến trình, chi tiết Dự án, thanh tổng danh sách tải và thanh tổng quy trình tải–ghép.

## Kết quả kiểm tra tự động

- Asset: 2 PNG, 1 ICO và 1 SVG hợp lệ.
- TypeScript: đạt.
- ESLint: đạt, không có cảnh báo.
- Unit test: 74/74 đạt.
- SQLite integration: 8/8 đạt.
- Production build: đạt.

## Hành vi cần xác nhận trên Windows

1. Bắt đầu danh sách có ít nhất hai video tải song song.
2. Khi đang tải, thanh của video tương ứng vẫn có vệt sáng chuyển động.
3. Khi một video hoàn tất trước video còn lại, thanh của video hoàn tất phải đứng yên ở 100%.
4. Video còn đang tải vẫn tiếp tục có hiệu ứng và cập nhật phần trăm bình thường.
5. Video hiện `Đã tải trước đó – đã bỏ qua` phải đứng yên ở 100%.
6. Khi toàn bộ danh sách hoàn tất, thanh tổng cũng đứng yên.
7. Tạm dừng danh sách hoặc quy trình phải dừng hiệu ứng thanh tổng ngay.

## Cách chạy

```powershell
cd "ĐƯỜNG_DẪN\Tubmedia_v0.8.5_SOURCE"

npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Chưa tạo installer trong vòng kiểm tra source này.
