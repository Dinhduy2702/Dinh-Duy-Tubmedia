# Hướng dẫn phát hành Tubmedia

Tài liệu này thay thế `PHAT_HANH_CHINH_THUC_v1.0.0_VI.md` (đã lỗi thời — chỉ nhắc `npm.cmd run
dist:official` cho bản 1.0.0, chưa có Trung tâm cập nhật, chưa có kênh thử nghiệm, chưa có ghi chú phát
hành tự động). Cập nhật lần cuối: 2026-09-24, cho phiên bản 1.3.7.

## 1. Nguyên tắc chung

- **`package.json` là nguồn duy nhất cho số phiên bản.** Mọi nơi khác (nhãn hiển thị trong ứng dụng,
  `package-lock.json`, `.github/workflows/publish-tubmedia-release.yml`, `CHANGELOG.md`,
  `source-manifest.json`) chỉ PHẢN CHIẾU giá trị đó — không tự sửa tay từng nơi.
- **`CHANGELOG.md` là nguồn duy nhất cho ghi chú phát hành.** Kể từ 2026-09-24, cả 2 con đường phát hành
  bên dưới đều tự động trích đúng mục của phiên bản đang phát hành từ `CHANGELOG.md` và đưa vào ghi chú
  phát hành — cả trong GitHub Release lẫn trong `latest.yml`/`beta.yml` (hiển thị ngay trong Trung tâm cập
  nhật của ứng dụng). **Không gõ tay ghi chú phát hành ở bất kỳ nơi nào khác** (trước đây workflow GitHub
  Actions từng có một bản chép tay riêng, không đồng bộ với `CHANGELOG.md` thật — đã sửa).
- **Không có chữ ký Authenticode.** Windows có thể hiển thị "Unknown publisher" hoặc SmartScreen cho bộ
  cài. Luôn cung cấp SHA-256 để người dùng tự xác minh.
- **Không bao giờ hạ cấp.** Cả `AppUpdateService` (runtime) lẫn `build-release-windows.ps1` (build) đều
  chủ động chặn version thấp hơn hiện tại.

## 2. Trước khi phát hành bất kỳ phiên bản nào

1. **Tăng số phiên bản bằng một lệnh duy nhất** — không tự sửa tay từng tệp:
   ```powershell
   npm.cmd run bump -- 1.4.0
   ```
   Lệnh này cập nhật đồng bộ: `package.json`, `package-lock.json`,
   `src/shared/constants/app.ts` (nhãn hiển thị), `EXPECTED_VERSION` trong
   `.github/workflows/publish-tubmedia-release.yml`, thêm một mục mới đầu `CHANGELOG.md` với dòng tạm
   `CHƯA ĐIỀN GHI CHÚ PHÁT HÀNH`, và tạo lại `source-manifest.json`/`SOURCE_INVENTORY.sha256`. Dùng thêm
   `--dry-run` để xem trước không ghi gì, hoặc xem `npm.cmd run bump -- --help` kiểu comment đầu
   `scripts/bump-version.mjs`.

2. **Mở `CHANGELOG.md`, thay dòng `CHƯA ĐIỀN GHI CHÚ PHÁT HÀNH` bằng ghi chú thật** — tiếng Việt, dạng
   gạch đầu dòng, mô tả đúng những gì đã đổi cho người dùng cuối (không phải nhật ký commit kỹ thuật).
   Đây là nội dung DUY NHẤT sẽ hiển thị làm ghi chú phát hành ở cả 2 con đường bên dưới — viết đúng ngay ở
   đây, không cần và không nên sửa lặp lại ở nơi khác.

3. **Chạy `npm.cmd run check` đầy đủ** và đảm bảo đạt hoàn toàn trước khi commit. `verify:stable` (nằm
   trong `npm.cmd run check`) sẽ chặn nếu `CHANGELOG.md` không bắt đầu đúng bằng
   `# Tubmedia <version-mới>` hoặc còn sót dòng `CHƯA ĐIỀN GHI CHÚ PHÁT HÀNH`.

4. **Commit** với đúng tiền tố `release: Tubmedia <version>` (ví dụ `release: Tubmedia 1.4.0`) — đây
   chính là điều kiện để workflow GitHub Actions ở Con đường A tự kích hoạt khi push lên `main` (xem mục
   3). Nếu chỉ muốn build thử/phát hành kênh thử nghiệm (Con đường B), không bắt buộc theo đúng tiền tố
   này.

## 3. Con đường A — Phát hành chính thức qua GitHub Actions (khuyến nghị)

Workflow: `.github/workflows/publish-tubmedia-release.yml`. Đây là con đường ĐÃ XÁC NHẬN thực sự đang
dùng cho các bản phát hành công khai trên GitHub Releases (đối chiếu lịch sử commit `release: Tubmedia
1.3.7`).

**Kích hoạt**: push một commit có message bắt đầu bằng `release: Tubmedia ` lên nhánh `main`, hoặc chạy
thủ công qua tab Actions → "Publish Tubmedia Release" → Run workflow (`workflow_dispatch`).

**Workflow tự động làm** (không cần thao tác tay nào khác ngoài Mục 2 ở trên):

1. Kiểm tra `package.json` khớp đúng `EXPECTED_VERSION` đã ghi trong chính workflow này (do
   `npm.cmd run bump` tự cập nhật ở bước 1 Mục 2 — nếu quên bump trước khi sửa version tay, bước này sẽ
   chặn lại) và nhãn phiên bản renderer khớp `package.json`.
2. Kiểm tra tag/release `vX.Y.Z` CHƯA tồn tại — từ chối ghi đè một bản đã phát hành.
3. Cài NSIS nếu máy runner chưa có.
4. Chạy `npm.cmd run dist:official` — build, `npm.cmd run check` đầy đủ, đóng gói NSIS, tạo blockmap, và
   viết `latest.yml` (đã có sẵn ghi chú phát hành thật từ `CHANGELOG.md`, xem Mục 5).
5. Xác minh SHA-256 của installer khớp đúng tệp checksum đã tạo.
6. Trích ghi chú phát hành từ `CHANGELOG.md` (qua `node scripts/changelog-section.mjs <version>`), ghép
   với phần "Xác minh bản phát hành"/"Chữ ký Windows" tạo động (SHA-256 thật, commit thật).
7. Tạo GitHub Release ở trạng thái **DRAFT** trước, tải các tệp đã tải lên xuống lại và so khớp
   byte-for-byte với bản cục bộ — chỉ khi khớp tuyệt đối mới công khai thành bản **Latest**.

Nếu bất kỳ bước nào thất bại, workflow dừng ngay và KHÔNG có bản Latest mới nào được công bố — bản draft
(nếu đã tạo) cần được kiểm tra/xóa thủ công trước khi thử lại.

## 4. Con đường B — `release:windows` (máy chủ cập nhật tự lưu trữ riêng + kênh thử nghiệm)

Dùng khi: tự vận hành máy chủ cập nhật HTTPS riêng (không qua GitHub Releases), hoặc muốn phát hành một
bản **thử nghiệm/release-candidate** cho một nhóm nhỏ trước khi phát hành chính thức ở Con đường A.

```powershell
$env:TUBMEDIA_UPDATE_URL = "https://updates.tenmiencuaban.com/tubmedia/"
$env:TUBMEDIA_UPDATE_CHANNEL = "beta"   # hoặc "stable" — mặc định "stable" nếu bỏ trống
npm.cmd run release:windows
```

**Quy tắc kênh** (đã được `build-release-windows.ps1` tự kiểm tra, không cần nhớ tay):

- Kênh `stable` **không được nhận** version có hậu tố prerelease (ví dụ `1.4.0-rc.1`) — script chặn ngay
  từ đầu, tránh phát hành nhầm bản thử nghiệm thành bản chính thức.
- Muốn thử nghiệm một release-candidate: đặt `version` trong `package.json` dạng `1.4.0-rc.1` (qua
  `npm.cmd run bump -- 1.4.0-rc.1`) **và** dùng `TUBMEDIA_UPDATE_CHANNEL=beta`.
- Người dùng muốn nhận bản thử nghiệm cần tự đổi "Kênh cập nhật ứng dụng" sang **Thử nghiệm** trong Cài
  đặt của Tubmedia (mặc định người dùng luôn ở kênh Ổn định).

**Script tự làm**: chuẩn bị Electron + công cụ bắt buộc (yt-dlp/ffmpeg/ffprobe), chạy
`npm.cmd run check` đầy đủ, đóng gói qua electron-builder (`--publish never`, không tự đẩy lên đâu cả),
**chèn thêm ghi chú phát hành thật từ `CHANGELOG.md`** vào từng tệp `latest.yml`/`beta.yml` mà
electron-builder vừa tạo (qua `scripts/inject-changelog-release-notes.mjs` — bước riêng vì
electron-builder tự tạo các tệp này theo cách khác với Con đường A, xem Mục 5), rồi tạo
`release-manifest.json` (SHA-256 từng tệp).

**Sau khi script chạy xong**: tự tay tải installer, `latest.yml`/`beta.yml` và blockmap lên đúng
`TUBMEDIA_UPDATE_URL` (script KHÔNG tự tải lên máy chủ — chỉ đóng gói và xác minh cục bộ). Người dùng cấu
hình URL này trong Cài đặt → "Máy chủ cập nhật ứng dụng tùy chọn (HTTPS)" để chuyển sang nhận cập nhật từ
máy chủ riêng thay vì GitHub.

## 5. Vì sao có 2 nơi viết `releaseNotes` khác nhau vào `latest.yml`

Hai con đường phát hành tạo `latest.yml`/`beta.yml` theo hai cách KHÁC NHAU, nên cần hai bước chèn ghi
chú riêng — cả hai đều lấy từ đúng một nguồn (`scripts/changelog-section.mjs`), không có nội dung nào bị
gõ tay lặp lại:

- **Con đường A** (`dist:official` → `dist:nsis-safe`): `scripts/write-updater-metadata-utf8nobom.mjs` tự
  viết `latest.yml` HOÀN TOÀN TỪ ĐẦU (không dùng bản electron-builder tạo ra, vì bản đó từng có vấn đề
  encoding/BOM) — ghi chú phát hành được lấy từ `CHANGELOG.md` ngay trong lúc dựng tệp.
- **Con đường B** (`release:windows`): electron-builder tự tạo `latest.yml`/`beta.yml` với đầy đủ cấu
  trúc riêng của nó — `scripts/inject-changelog-release-notes.mjs` đọc lại, CHÈN THÊM trường
  `releaseNotes`, giữ nguyên mọi trường khác electron-builder đã tạo.

## 6. Cách người dùng thấy ghi chú phát hành

Khi Tubmedia phát hiện có bản mới (Trung tâm cập nhật, tự động hoặc bấm "Kiểm tra cập nhật"), thông tin
`releaseNotes` trong `latest.yml`/`beta.yml` hoặc thân GitHub Release được hiển thị trong mục "Thông tin
phiên bản" ngay trên trang — xem `formatReleaseNotesForDisplay()` (`src/shared/release-notes.ts`) và
`UpdatesPage.tsx`. Lỗi kiểm tra/tải cập nhật (mất mạng, máy chủ chưa có metadata...) luôn hiển thị dưới
dạng **cảnh báo màu vàng**, không phải lỗi đỏ — ứng dụng vẫn dùng bình thường trong lúc đó. Nếu còn tác vụ
tải/cắt/ghép đang chạy, thao tác "Cài đặt & khởi động lại" bị chặn với thông báo cảnh báo rõ ràng
(`UPDATE_BLOCKED_ACTIVE_WORK`) thay vì báo lỗi.

## 7. Phạm vi gỡ cài đặt (giữ từ tài liệu cũ — vẫn đúng)

Uninstaller chỉ xóa thư mục cài đặt của Tubmedia cùng shortcut và khóa Registry của ứng dụng. Video trong
thư mục người dùng tự chọn (ví dụ `E:\Ghép video`) không nằm trong thư mục cài đặt và không bị xóa. Cấu
hình/database trong AppData được giữ lại để cài lại hoặc nâng cấp không mất trạng thái.

## 8. Việc cần làm trước khi bấm phát hành — tóm tắt nhanh

- [ ] `npm.cmd run bump -- <version>` đã chạy, không còn báo lỗi.
- [ ] `CHANGELOG.md` đã có ghi chú thật cho `<version>`, không còn dòng `CHƯA ĐIỀN GHI CHÚ PHÁT HÀNH`.
- [ ] `npm.cmd run check` đạt hoàn toàn.
- [ ] Commit đúng tiền tố `release: Tubmedia <version>` nếu dùng Con đường A.
- [ ] Nếu dùng Con đường B: đã đặt đúng `TUBMEDIA_UPDATE_URL`/`TUBMEDIA_UPDATE_CHANNEL`, và nhớ tự tải
      3 loại tệp (installer, `latest.yml`/`beta.yml`, blockmap) lên máy chủ sau khi script chạy xong.

## 9. Xử lý sự cố thường gặp

| Thông báo | Nguyên nhân | Cách xử lý |
|---|---|---|
| `CHANGELOG.md phải bắt đầu bằng "# Tubmedia <version>"` | Chưa chạy `npm.cmd run bump` hoặc chạy sai version | Chạy lại `npm.cmd run bump -- <version>` |
| `CHANGELOG.md ... vẫn còn dòng "CHƯA ĐIỀN GHI CHÚ PHÁT HÀNH"` | Quên viết ghi chú thật sau khi bump | Sửa `CHANGELOG.md`, thay dòng đó bằng ghi chú thật |
| `Release vX.Y.Z already exists` (workflow) | Tag/release đã tồn tại trên GitHub | Bump lên version mới, không phát hành lại đúng version cũ |
| `Kênh stable không nhận version prerelease` | Version có hậu tố `-rc.x`/`-beta.x` nhưng chưa đặt `TUBMEDIA_UPDATE_CHANNEL=beta` | Đặt biến môi trường trước khi chạy `release:windows`, hoặc đổi version về dạng chính thức |
| `CHANGELOG.md thiếu mục "# Tubmedia <version>"` (từ `write-updater-metadata-utf8nobom.mjs`/`inject-changelog-release-notes.mjs`) | Đang build với version không khớp `CHANGELOG.md` (ví dụ build lại bản cũ, hoặc quên bump) | Kiểm tra `package.json` và `CHANGELOG.md` khớp đúng version đang build |
