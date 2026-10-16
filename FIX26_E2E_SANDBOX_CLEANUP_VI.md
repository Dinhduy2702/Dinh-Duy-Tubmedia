# FIX26 — Bước dọn thư mục tạm của bài e2e làm trượt phát hành (2026-10-16)

## Hiện tượng

Lượt Publish #34 (run 38865391717, phát hành 1.7.0) trượt ở bài e2e "Đợt 5 mục 19". Phần kiểm chức năng đã qua; lỗi xảy ra
ở bước dọn: `EPERM, Permission denied` khi xóa thư mục `tubmedia-e2e-unsupported-url-*` ngay sau khi đóng app. Bộ e2e chạy
nối tiếp nên 10 bài phía sau "did not run" → không build bộ cài, không phát hành. Lần phát hành 1.6.1 (run 37748960748)
từng trượt đúng lỗi này ở một bài không tải video nào (`tubmedia-e2e-notify-spam-*`).

## Nguyên nhân gốc

`removeSandbox` dùng `fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })`, tưởng là thử
lại ~11 giây. Đo trên Node 24.18.0 (bản CI dùng): thư mục còn bị giữ thì `fs.rmSync` báo EPERM **sau 1 ms**, không thử lại
lần nào; `fs.promises.rm` với cùng tuỳ chọn thì thử lại đúng (xóa được sau 5,6 s khi khóa nhả). Vậy chỉ cần Windows giữ khóa
vài mili giây sau khi giết cây tiến trình Electron (máy CI chậm, chống virus quét tệp mới) là bài trượt.

Không liên quan bản sửa _MEI (FIX22): thư mục tạm của yt-dlp nằm ở `%TEMP%\tubmedia-ytdlp-runtime`, ngoài sandbox; yt-dlp
chạy với cwd là thư mục dự án; lỗi đã có từ 1.6.1, trước khi có FIX22. Ở máy dev (2 nhân) đo 28 lần xóa sandbox, gồm 10 lượt
lặp đúng bài này: lần nào cũng xong trong 19–28 ms, không lần nào bị khóa. Không thấy lỗi của app.

## Sửa

- `tests/e2e/helpers/sandbox-cleanup.ts`: tự thử lại bằng `fs.promises.rm` mỗi 250 ms, tối đa 60 s. Quá hạn thì trả kết quả
  `removed: false` kèm lỗi và các tệp còn sót, KHÔNG ném lỗi.
- `tests/e2e/app.spec.ts`: 47 chỗ gọi `await removeSandbox(...)`. Không xóa được thì ghi chẩn đoán (tiến trình electron/
  yt-dlp/ffmpeg/ffprobe/crashpad/MsMpEng đang chạy + tệp còn sót) vào `electron-shell-runtime.log`, console và chú thích
  của bài — lần sau trên CI biết chính xác thứ gì giữ khóa.
- Test: `tests/unit/e2e-sandbox-cleanup.test.ts` (đỏ với bản cũ: báo EPERM sau 22 ms).

## Thêm: bài "phát hiện bản cập nhật hiện thông báo rõ ràng" chập chờn trên máy chậm

Khi chạy lại toàn bộ e2e trên 2 nhân để tái hiện, bài này trượt 1 lần ("element is not stable" → "detached" lúc bấm
"Cập nhật ngay"). Đo bằng bộ quan sát DOM: thông báo hiện ngay khi trang tải xong, TRƯỚC lúc bài kiểm thấy thanh bên; bài
kiểm lại chờ cứng 6 giây tính từ lúc nó nhìn thấy thông báo, nên dưới tải (2 nhân + 2 tiến trình đốt CPU) thông báo tự tắt
đúng hạn 12 giây giữa lúc chờ (1/12 lượt). App đúng; bài kiểm đo sai mốc.

Sửa: đọc `--attention-duration` (AttentionCenter đặt bằng đúng giá trị của hẹn giờ tự tắt) và đòi ≥ 12 000 ms, rồi bấm ngay.
Kiểm đỏ: tạm cho thông báo cập nhật dùng thời lượng mức "info" như lỗi cũ → bài báo 4800 < 12000. Sau sửa: 11/12 lượt qua
dưới tải; lượt còn lại trượt ở bước chờ app khởi động 30 giây do tải ép thêm, trước phần kiểm thông báo.
