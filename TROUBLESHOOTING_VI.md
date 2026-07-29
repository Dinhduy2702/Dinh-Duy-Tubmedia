# Xử lý lỗi

- **Tool broken**: mở Tools, kiểm tra path và chạy Health Check.
- **Video private/bot**: chọn cookies file hoặc Cookies from Browser trong Settings.
- **HTTP 429/fragment**: queue tự retry có backoff; có thể tắt aria2c.
- **Disk full**: đổi Temp/Output hoặc dọn cache; không retry cho đến khi đủ dung lượng.
- **File hỏng**: file được đánh dấu invalid/quarantine, không xóa final cũ.
- **NVENC lỗi**: Tool Manager sẽ không bật capability; pipeline fallback CPU.
- **Ứng dụng tắt đột ngột**: job đang chạy chuyển interrupted và được đưa lại queue khi mở lại.

## `Could not find any Python installation to use`

Đây là lỗi từ `node-gyp` khi rebuild `better-sqlite3` cho Electron. Chạy:

```powershell
npm.cmd run doctor:windows
```

Nếu Python thiếu:

```powershell
winget install -e --id Python.Python.3.13 --accept-package-agreements --accept-source-agreements
```

Nếu Visual C++ Build Tools thiếu:

```powershell
winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-package-agreements --accept-source-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Đóng PowerShell, mở lại tại thư mục project rồi chạy:

```powershell
npm.cmd run rebuild
```

## TypeScript 6 báo `baseUrl` deprecated

Lỗi này đã được sửa từ bản 0.1.1. `paths` hiện dùng đường dẫn tương đối và không cần `baseUrl`.

## Windows báo “An Application Control policy has blocked this file”

Từ phiên bản 0.1.2, database dùng `node:sqlite` tích hợp sẵn và không còn nạp `better_sqlite3.node`. Chạy `npm.cmd install` để gỡ dependency native cũ, sau đó chạy lại integration test.
