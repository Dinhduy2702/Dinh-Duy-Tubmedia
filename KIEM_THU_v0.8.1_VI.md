# Biên bản kiểm tra Tubmedia v0.8.1

## Lỗi đã sửa

- `src/renderer/public/tubmedia-app-icon.png` bị cắt dữ liệu ở byte `393321`.
- Source mới không còn để file hỏng sót lại khi giải nén đè lên thư mục phiên bản cũ.
- Timeline trước đây chỉ hiện thứ tự liên kết, chưa hiện mốc thời gian thực của thành phẩm.

## Định dạng timeline mới

Tệp TXT và giao diện sau khi ghép dùng cùng một định dạng:

```text
00:00 Ph Video_001
02:14 Ph Video_002
05:47 Ph Video_003
```

Trước khi ghép xong, giao diện dùng `--:-- Ph Video_001` để báo đây mới là thứ tự xem trước. Sau khi backend đo thời lượng thật bằng ffprobe, các mốc `00:00`, `02:14`... được lưu trong SQLite và hiển thị lại trên giao diện.

CSV và JSON vẫn giữ thêm tiêu đề video, ghi chú, đường dẫn tệp, thời điểm bắt đầu/kết thúc và thời lượng chính xác.

## Cách kiểm tra sạch trên Windows

Khuyến nghị giải nén vào thư mục mới. Nếu giải nén đè lên source cũ, bản v0.8.1 vẫn ghi đè đúng file PNG lỗi.

```powershell
cd "ĐƯỜNG_DẪN\Tubmedia_v0.8.1_SOURCE"

npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Kết quả bắt buộc của bước asset:

```text
Đã kiểm tra 2 PNG, 1 ICO và 1 SVG: hợp lệ.
```

Sau đó chạy thử một quy trình ghép và kiểm tra:

1. Các dòng trước khi chạy có dạng `--:-- Ph Video_001`.
2. Sau khi ghép thành công, các dòng đổi thành thời gian thật như `00:00 Ph Video_001`.
3. Thư mục thành phẩm có đủ MP4, timeline TXT, CSV và JSON theo tên sản phẩm.
4. Đóng rồi mở lại ứng dụng, timeline thực vẫn còn trên giao diện.

Chỉ chạy `npm.cmd run dist` sau khi kiểm tra Windows đạt.
