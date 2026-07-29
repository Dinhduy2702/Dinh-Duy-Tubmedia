# Tubmedia v1 — phát hành và cập nhật lâu dài

## Mục tiêu

Bản cài đặt chính thức dùng `electron-builder` + NSIS với một danh tính cố định:

- App ID: `com.tubmedia.download-video`
- Product name: `Download video Tubmedia`
- Dữ liệu người dùng không bị xóa khi nâng cấp hoặc gỡ cài đặt mặc định.

Không đổi App ID, GUID hoặc tên product ở các bản sau. Thay đổi các giá trị này có thể khiến Windows coi ứng dụng là sản phẩm khác.

## Máy chủ cập nhật

Tubmedia dùng Generic HTTPS provider. Trên máy chủ, mỗi kênh phải có cùng một thư mục chứa:

- Installer `.exe`
- `latest.yml` cho kênh ổn định hoặc `beta.yml` cho kênh thử nghiệm
- File `.blockmap` đi cùng installer

Ví dụ:

```text
https://updates.example.com/tubmedia/stable/
https://updates.example.com/tubmedia/beta/
```

Không đổi hoặc xóa metadata khi installer chưa được tải lên đầy đủ. Nên tải EXE và blockmap trước, metadata YML sau cùng để người dùng không nhìn thấy một bản phát hành chưa hoàn chỉnh.

## Build bản thử nghiệm RC

```powershell
$env:TUBMEDIA_UPDATE_URL = "https://updates.example.com/tubmedia/beta/"
$env:TUBMEDIA_UPDATE_CHANNEL = "beta"
npm.cmd run release:windows
```

## Build bản ổn định

1. Đổi version từ `1.0.0-rc.1` thành `1.0.0` hoặc version ổn định tiếp theo.
2. Cập nhật `CHANGELOG.md`.
3. Chạy:

```powershell
$env:TUBMEDIA_UPDATE_URL = "https://updates.example.com/tubmedia/stable/"
$env:TUBMEDIA_UPDATE_CHANNEL = "stable"
npm.cmd run release:windows
```

Kết quả nằm trong thư mục `release` cùng `release-manifest.json` và SHA-256.

## Ký số Windows

Bản test nội bộ có thể chưa ký. Bản phát hành công khai nên cấu hình chứng thư ký mã qua biến chuẩn của electron-builder:

```powershell
$env:CSC_LINK = "C:\secure\certificate.pfx"
$env:CSC_KEY_PASSWORD = "mat-khau-chung-thu"
```

Không lưu tệp PFX hoặc mật khẩu vào source, Git hoặc file ZIP gửi hỗ trợ.

## Quy trình cập nhật của người dùng

1. App tự kiểm tra sau khi khởi động và mỗi 6 giờ.
2. Khi có bản mới, app hiện thông báo và huy hiệu tại Trung tâm cập nhật.
3. Người dùng chủ động tải trong nền.
4. Nút cài chỉ hoạt động khi không còn tác vụ chạy.
5. App giữ tối đa 5 bản sao lưu tự động trước cập nhật, sau đó khởi động lại và nâng cấp tại chỗ.
6. Dự án, database, cookies và cài đặt nằm trong userData nên được giữ nguyên.

## Kênh phát hành

- `beta`: thử nghiệm RC trên một nhóm máy trước.
- `stable`: chỉ phát hành sau khi unit, integration, typecheck và test thực tế tải/ghép đều đạt.

Không đưa version có hậu tố `-rc`, `-beta` lên kênh stable. Script release sẽ chặn trường hợp này.
