# Media Pipeline

## Download

1. Canonical identity theo URL/platform/media-id, không theo title.
2. Chế độ source mặc định không cap resolution/FPS/codec/container.
3. yt-dlp hoàn tất -> kiểm tra file thật -> ffprobe -> quality policy -> cache/materialize.
4. Remux/CapCut dùng tên không xung đột, không xóa MP4 cùng basename của người dùng.

## Clip

- Không cắt + mute: `-c:v copy -an`.
- Có cắt: vẫn transcode để bảo đảm timestamp chính xác theo pipeline hiện tại.

## Smart Merge

1. Probe và cache MediaInfo theo fingerprint.
2. So sánh codec/container/resolution/FPS/pixel format/audio/SAR/DAR/rotation/VFR/HDR.
3. Copy/remux/audio-only/video-only/full normalize theo mismatch.
4. `allowUpscale=false`: scale decrease + pad; không crop mặc định.
5. Concat cuối `-c copy`.
6. Verify pending -> backup final cũ -> atomic rename.

## HDR

- 10-bit SDR không tự động là HDR.
- PQ -> HDR10, HLG -> HLG, side-data DOVI -> Dolby Vision.
- `HDR Auto` giữ HDR khi toàn bộ nguồn HDR; trộn HDR/SDR vẫn cần UX lựa chọn rõ hơn.

## Hạng mục mở

- Báo cáo chi tiết size theo từng stage vẫn cần bổ sung; gate hiện đã so final với input trước normalize.
- Media fixture thực cho HDR/VFR/rotation/SAR/timestamp lỗi.
- Stream/packet hash chứng minh copy/remux.
