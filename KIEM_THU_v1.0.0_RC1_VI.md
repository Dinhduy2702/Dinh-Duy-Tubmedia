# Kiểm thử Tubmedia v1.0.0 RC1

## Phạm vi rà soát

- Tải danh sách đa nền tảng, skip theo link, cookies theo nhu cầu, aria2c fallback.
- Tải Google Drive và ghép video, chuẩn hóa, concat stream-copy và bảo vệ dung lượng.
- Queue, pause/resume/cancel/retry, phục hồi sau khi đóng ứng dụng.
- SQLite progress không NULL/NaN, phân tách cache giữa từng lane.
- Dọn `_normalized`, `_quarantine`, file part/fragment/concat/pending.
- Giao diện, batching tiến trình, thông báo enter/exit dùng compositor, dark/light red theme và ghi file log nền.
- Auto update, backup trước update, metadata/blockmap và installer identity.
- Electron sandbox, context isolation, permission deny, external link policy.

## Lệnh kiểm tra bắt buộc

```powershell
npm.cmd install
npm.cmd run verify:release
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:integration
npm.cmd run dev
```

## Test thực tế cuối cùng

1. Dùng ít nhất 2 danh sách tải chạy song song với link từ YouTube, Facebook/TikTok hoặc nền tảng khác.
2. Dùng một quy trình ghép 4 video Google Drive có profile H.264 khác nhau.
3. Tạm dừng, tiếp tục, đóng app an toàn rồi mở lại.
4. Kiểm tra giao diện khi CPU/FFmpeg đang chạy và khi cửa sổ bị thu nhỏ.
5. Kiểm tra thông báo success/info trượt vào–ra mượt khi FFmpeg đang chạy, warning đủ thời gian đọc, hover sẽ tạm dừng timer và error chỉ mất khi bấm đóng.
6. Kiểm tra thành phẩm nằm trực tiếp trong thư mục đầu ra; thư mục tạm được dọn sau thành công.
7. Build beta installer, cài lên một máy test, sau đó phát hành một beta version cao hơn để kiểm tra update tại chỗ.

## Tiêu chí đạt

- Không lỗi TypeScript, lint, unit hoặc integration.
- Không crash main process.
- Không tải lại file đã xác nhận hợp lệ theo link.
- Không giảm dung lượng ngoài chính sách preset đã chọn.
- Không để file tạm tăng vô hạn.
- Giao diện vẫn phản hồi khi tải và FFmpeg chạy.
- Update không cài trong lúc hàng đợi đang chạy và không làm mất dữ liệu.
