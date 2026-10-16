# FIX25 — Bản đệm chuẩn hóa / remux: tệp tạm riêng cho từng lần làm, chốt an toàn khi bản đệm đang bị mở

## Vì sao

Ghi chú tồn đọng của FIX18. Hai quy trình ghép dùng chung một nguồn (cùng thư mục xuất) cùng làm một bản đệm:

- cả hai ghi vào CÙNG một tệp tạm `<bản đệm>.pending.mp4`;
- chốt bằng `rm(bản đệm)` rồi `rename(tệp tạm, bản đệm)`. Bản đệm đang bị quy trình kia mở (đang ghép) thì Windows từ chối
  xóa — tái hiện thật: `EBUSY: resource busy or locked, unlink '…normalized-640x360-30fps.mp4'` → quy trình này hỏng.

## Sửa

- Tệp tạm riêng cho mỗi lần làm: `<bản đệm>.<mã>.pending.mp4` (giữ đuôi `.pending.mp4` để bộ dọn rác vẫn nhận ra). Áp
  cho cả chuẩn hóa lẫn remux.
- Chốt bằng `rename` ghi đè thẳng. Không ghi đè được (bản đệm đang bị mở) → dùng tệp vừa làm dưới tên riêng
  `<bản đệm bỏ .mp4>.<mã>.mp4` cho quy trình này, log cảnh báo `NORMALIZE_CACHE_IN_USE`. KHÔNG dùng bản đệm cũ: nó có thể
  chính là bản vừa bị loại vì không qua kiểm tra (FIX18).

## Kiểm tra

- Unit `normalize-cache-pending-per-job.test.ts`: hai lần chuẩn hóa cùng nguồn chạy chồng lên nhau → hai tệp tạm khác nhau,
  đều đuôi `.pending.mp4`, xong không sót tệp tạm. Mã cũ: đỏ (cùng một tệp tạm).
- Integration `normalize-cache-commit-locked.test.ts` (ffmpeg thật): bản đệm cũ hỏng tiếng và đang bị một ffmpeg khác
  đọc → quy trình mới làm lại không hỏng, nhận tệp mới giải mã tiếng sạch (không phải tệp tạm), bản đang bị mở vẫn còn.
  Mã cũ: đỏ (`EBUSY … unlink`).
