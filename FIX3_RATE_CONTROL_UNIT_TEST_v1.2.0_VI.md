# Tubmedia 1.2.0 FIX3 - Rate control cho chế độ giữ dung lượng gần nguồn

## Lỗi còn lại

Unit test `uses source-average bitrate instead of CRF when the keep-size profile must encode video` yêu cầu lệnh FFmpeg có đủ:

- `-b:v`
- `-minrate`
- `-maxrate`
- `-bufsize`

Code trước FIX3 đã có `-b:v`, `-maxrate`, `-bufsize` nhưng thiếu `-minrate`.

## Cách sửa

Khi `bitrateMode = source_average` và bắt buộc mã hóa lại video, Tubmedia dùng cửa sổ bitrate:

- Bitrate mục tiêu: 100% bitrate trung bình nguồn.
- Bitrate tối thiểu: 85% bitrate mục tiêu.
- Bitrate tối đa: 115% bitrate mục tiêu.
- Bộ đệm VBV: 200% bitrate mục tiêu.

Cách này giữ dung lượng gần nguồn hơn, tránh file thành phẩm giảm quá mạnh, nhưng vẫn cho encoder đủ khoảng dao động để duy trì chất lượng.

## Phạm vi thay đổi

`src/main/normalize/normalize-engine.ts`

Không sửa hoặc vô hiệu hóa unit test.
