# FIX18 — Bản đệm chuẩn hóa/remux phải giải mã toàn bộ hình + tiếng trước khi dùng lại

## Vụ việc (máy khách, 2026-10-15)

Job ghép `03002b08…` ("Hậu maxhunter 21 10 26") bị hậu kiểm chặn ở 11:05, app quy cho nguồn #2 NA361_TA.mp4. Đối chiếu
gói chẩn đoán khách gửi:

| Kiểm tra | Kết quả |
|---|---|
| NA361 trên máy khách | 604.101.287 byte, SHA256 `4EB08A68…6CBD` — trùng tuyệt đối bản trên máy dev; giải mã toàn bộ sạch |
| Câu lỗi ffmpeg (đoạn 1 phút quanh 11:05) | `[aac] error in spectral data, ESC overflow` — luồng tiếng hỏng, luồng hình sạch |
| Vị trí | 11:05 thành phẩm = 2:41,9 trong NA361 (nguồn #1 dài 503,85 s) — giữa video, không phải điểm nối |
| Luồng tiếng thành phẩm | AAC 48 kHz (nguồn 44,1 kHz) → tiếng đã được mã hóa lại, gói hỏng nằm trong **bản chuẩn hóa** |
| Log lần ghép | Cả 8 nguồn `NORMALIZE_CACHE_HIT` từ `E:\VIDEO GHÉP\_normalized-cache\` |

Kết luận: **nguồn không hỏng; bản đệm chuẩn hóa của NA361 hỏng một gói AAC**, và app không bao giờ phát hiện ra:

- `validNormalizeCache` / `validRemuxCache` chỉ kiểm mức `standard` = thử 3 khung hình (đầu/giữa/cuối), **không giải mã
  tiếng**.
- Bản đệm không phải "nguồn stream-copy" nên cũng không qua bước "kiểm tra toàn bộ nguồn" của `MergeEngine` (ghi chú
  R35 ở đó chỉ đúng cho tệp vừa mã hóa, không đúng cho tệp lấy lại từ đệm).
- Hậu quả: bản hỏng được dùng lại ở **mọi** lần ghép, lần nào hậu kiểm cũng chặn ở cùng chỗ; thay tệp nguồn cùng nội dung
  cũng không giúp (chỉ khi đổi tên/ngày sửa thì khóa đệm mới đổi).

**Cập nhật cùng ngày:** khách đã xóa bản đệm NA361 rồi ghép lại nhưng VẪN lỗi tiếng AAC ở cùng chỗ → lỗi lặp lại được,
không phải bản đệm hỏng ngẫu nhiên. Trên máy dev, đúng lệnh chuẩn hóa của app (ffmpeg đi kèm bản cài, build 2026-10-11, và
ffmpeg 8.1.2) cho ra tiếng giải mã sạch — chưa tái hiện được. Máy khách dùng ffmpeg khác
(`%APPDATA%\video-download-merge-studio-pro\tools\current\ffmpeg.exe`). Nguyên nhân gốc đang điều tra tiếp.

Bản sửa này vẫn cần (bản đệm hỏng vì bất kỳ lý do gì không còn được dùng lại mãi), nhưng **một mình nó chưa gỡ được vụ của
khách**: nếu bước chuẩn hóa trên máy khách luôn tạo ra tiếng hỏng thì bản làm lại cũng hỏng.

## Sửa

`NormalizeEngine`:

- Bản đệm chuẩn hóa và bản đệm remux: kiểm thông số trước (ffprobe, rẻ), rồi **giải mã toàn bộ hình + tiếng** (`verify`
  mức `deep`, `-xerror -err_detect explode`) trước khi dùng lại — cùng mức đang áp cho nguồn stream-copy.
- Không qua → log cảnh báo `NORMALIZE_CACHE_REJECTED` / `REMUX_CACHE_REJECTED` kèm lý do (câu lỗi ffmpeg), xóa bản đệm, làm
  lại từ nguồn. Các bản đệm hỏng ẩn khác tự lành ở lần dùng kế tiếp, không cần dọn tay.
- Kiểm nhận tín hiệu tạm dừng/hủy; bị dừng giữa lúc kiểm thì **giữ** bản đệm (chưa chứng minh là hỏng) và dừng.
- Chi phí: mỗi bản đệm thêm một lượt giải mã (không mã hóa) — vẫn rẻ hơn nhiều so với chuẩn hóa lại.

## Kiểm tra

Integration `normalize-cache-corrupt-audio.test.ts`, chạy ffmpeg thật:

- Bản đệm chuẩn hóa bị ghi đè 40 gói AAC (hình sạch, tiếng hỏng — đúng kiểu của khách) → không `NORMALIZE_CACHE_HIT`, tệp
  trả về giải mã sạch cả hình lẫn tiếng. Mã cũ: đỏ (`NORMALIZE_CACHE_HIT`).
- Như trên với bản đệm remux. Mã cũ: đỏ (`REMUX_CACHE_HIT`).
- Tín hiệu đã hủy → dừng, bản đệm còn nguyên, không mã hóa lại.
- Bản đệm sạch → vẫn `NORMALIZE_CACHE_HIT`, không mã hóa lại.

## Còn lại (chưa làm)

- Tệp vừa remux xong chỉ được kiểm `standard`; remux là chép luồng nên lỗi của nguồn đi thẳng sang — hậu kiểm thành phẩm
  vẫn chặn được, nhưng có thể kiểm sớm hơn.
- Hai danh sách ghép cùng lúc cùng nguồn, cùng thư mục xuất dùng chung đường dẫn `…normalized-….mp4.pending.mp4`; trên
  Windows thường thành lỗi "tệp đang mở" thay vì hỏng âm thầm, nhưng nên tách đường dẫn tạm theo job.
