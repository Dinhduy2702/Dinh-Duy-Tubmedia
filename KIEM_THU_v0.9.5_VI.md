# KIỂM THỬ TUBMEDIA v0.9.5 – GOOGLE DRIVE TẢI ĐÚNG TỆP GỐC

## Lỗi đã sửa

Google Drive cung cấp đồng thời tệp gốc đã tải lên và các bản xem trước do Google chuyển mã để phát trực tuyến. Bản cũ chọn theo codec/độ phân giải nên có thể lấy bản preview khoảng 200 MB thay vì tệp gốc hơn 500 MB.

## Hành vi mới

- Tải & Ghép với link Google Drive bắt buộc dùng `format_id=source`.
- Không áp dụng format-sort, codec, bitrate hoặc giới hạn của Tải danh sách.
- Nếu Drive không cấp quyền tải tệp gốc, quy trình báo lỗi và dừng; không âm thầm dùng preview.
- Cache cũ tự bị vô hiệu hóa bởi policy `merge-google-drive-original-source-v5`.
- Nhật ký thành công phải có `DOWNLOAD_FORMAT_CONFIRMED` với `selectedFormatId: source`.

## Cấu hình khuyên dùng

- Chất lượng thành phẩm: `Tệp gốc Google Drive · giữ gần dung lượng nguồn`.
- Hiệu năng: `Máy trạm cân bằng`.
- Chỉ chọn `1080p cố định · mã hóa lại CRF 18` khi muốn chạy giống bước chuẩn hóa của DownloadAndConcat(3).ts; cấu hình này chủ động mã hóa lại nên dung lượng có thể giảm.
