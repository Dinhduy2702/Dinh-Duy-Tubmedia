# Build Windows và cập nhật tại chỗ

Mở PowerShell trong thư mục source:

```powershell
npm.cmd install
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

`dev` tự chạy `install-electron` để bảo đảm `electron.exe` đã được tải.

Tạo installer:

```powershell
npm.cmd run dist
```

Hoặc:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\build-windows.ps1
```

File cài đặt nằm trong `release\Download video Tubmedia-Setup-<version>-x64.exe`.

Installer dùng định danh cố định trong `installer\identity.json`. Không đổi `appId`, `productName` hoặc `installRegistryKey` theo phiên bản. Khi máy đã có Tubmedia, installer tự đọc `InstallLocation`, bỏ trang chọn thư mục và cập nhật đúng vị trí cũ.

Tạo gói source để ghi đè vào source cũ:

```powershell
npm.cmd run dist:source-update
```

ZIP tạo ra không có thư mục bọc tên phiên bản; `package.json`, `src`, `scripts` và các tệp dự án nằm ngay ở gốc.

Production không chạy Vite/localhost; frontend được load từ asset local trong `out/renderer`.
