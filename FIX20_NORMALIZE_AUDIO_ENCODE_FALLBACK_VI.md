# FIX20 — Chuẩn hóa tự phát hiện tiếng AAC hỏng do bộ mã hóa và mã hóa lại phần tiếng

## Vụ việc (máy khách, 2026-10-15)

Job ghép `03002b08…` ("Hậu maxhunter 21 10 26"): hậu kiểm chặn vì tiếng AAC hỏng ở 11:05, khách xóa bản đệm và ghép lại
vẫn lỗi y như cũ. Nguyên nhân: ffmpeg 8.0 essentials (gyan.dev) trên máy khách (xem FIX19) mã hóa tiếng NA361 ở
`-c:a aac -b:a 256k -ar 48000 -ac 2` ra một gói hỏng (`[aac] error in spectral data, ESC overflow`); ffmpeg mới cũng
không giải mã được gói đó → lỗi của BỘ MÃ HÓA. Đo trên đúng bản 8.0:

| Tham số | 256k/48 kHz | 320k | 192k | 44,1 kHz | `-aac_coder fast` | `-q:a 2` |
|---|---|---|---|---|---|---|
| ffmpeg 8.0 essentials | hỏng | sạch | sạch | sạch | sạch | sạch |

Lỗi phụ thuộc nội dung và trạng thái bộ mã hóa: 170 giây tiếng đầu của NA361 là đủ tái hiện, cắt riêng đoạn quanh 2:41
thì không. Bước chuẩn hóa trước đây chỉ kiểm 3 khung hình (không giải mã tiếng) nên tệp hỏng đi thẳng tới hậu kiểm.

FIX19 tránh nguồn lỗi cụ thể này (không ưu tiên ffmpeg chép tay). Bản sửa này bắt mọi trường hợp tương tự — kể cả một
bản ffmpeg hợp lệ có lỗi bộ mã hóa.

## Sửa

- `FileVerifier.decodeStreamFailure(path, 'audio' | 'video')`: giải mã toàn bộ một luồng (`-xerror -err_detect explode`),
  trả câu lỗi gốc của ffmpeg hoặc null.
- `NormalizeEngine.normalizeToTarget`: khi phần tiếng được MÃ HÓA LẠI (không chép nguyên, không phải tiếng câm), giải mã
  toàn bộ luồng tiếng của tệp vừa tạo (nhanh). Hỏng →
  - log cảnh báo `NORMALIZE_AUDIO_ENCODE_CORRUPT` kèm phiên bản ffmpeg và câu lỗi;
  - mã hóa lại CHỈ phần tiếng từ nguồn bằng `-aac_coder fast` (cùng bitrate/tần số/kênh), chép nguyên phần hình đã mã hóa
    (`-c:v copy`), cùng các cờ mp4 như lượt chính;
  - kiểm lại tiếng; sạch → `NORMALIZE_AUDIO_ENCODE_REPAIRED`, dùng tệp đã sửa; vẫn hỏng → cách ly tệp, báo lỗi nêu rõ
    phiên bản ffmpeg.

## Kiểm tra

- Integration `normalize-audio-encoder-fallback.test.ts`, ffmpeg thật:
  - ffmpeg 8.0 essentials (`TUBMEDIA_TEST_FFMPEG_AAC_BUG_DIR`) + NA361 thật (`TUBMEDIA_TEST_NA361_SOURCE`, 165 giây tiếng
    đầu ghép với hình testsrc 320×180): tệp chuẩn hóa giải mã tiếng sạch (bằng ffmpeg mới), tiếng/hình lệch < 0,1 s, có
    cảnh báo kèm câu lỗi aac. Mã cũ: đỏ (đúng lỗi của khách). Thiếu một trong hai → tự bỏ qua.
  - ffmpeg tốt + clip thử: không cảnh báo, chỉ một lượt mã hóa.
- Unit `normalize-audio-encode-fallback.test.ts`: tham số lượt dự phòng (`-aac_coder fast`, `-c:v copy`, tiếng từ nguồn,
  48 kHz, 256k); dự phòng vẫn hỏng → cách ly + lỗi nêu phiên bản; tiếng sạch → một lượt; tiếng chép nguyên → không kiểm ở
  bước này. Mã cũ: đỏ 3/4.
