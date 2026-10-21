# Tệp tải về bị hụt hình nhưng vẫn được coi là hợp lệ (2026-10-21)

## Vì sao

YouTube `1JtdsqPbsXw` (10:41) tải bằng bản 1.7.0: luồng tiếng đủ 640,75 s nhưng luồng hình chỉ 586,7 s (9:47). So từng gói
hình với bản tải lại: mất trọn 10 mảnh HLS #16–#25 của định dạng 270 (1:21–2:15); phần sau bị dồn lên, hình chạy trước
tiếng 54 s. Danh sách mảnh của YouTube đầy đủ (122 mảnh = 640,7 s); tải lại cùng cờ thì đủ → lỗi lúc có lúc không trong lúc
tải, yt-dlp vẫn báo mã 0 dù có `--abort-on-unavailable-fragments`.

Tubmedia không bắt được vì:
- `selectMediaDuration` lấy max(hình, tiếng, container) = 640,75 ≈ 641 → kiểm tra thời lượng đạt;
- không so thời lượng luồng hình với luồng tiếng;
- HLS không công bố dung lượng hình nên kiểm tra dung lượng chỉ có số của luồng tiếng;
- lời nhắn của yt-dlp chỉ được lưu khi tải lỗi → lượt tải hỏng không để lại dấu vết.

Quét thư mục thật (chỉ đọc, 31 video): chỉ video này hỏng (2 bản cùng nội dung), 29 video còn lại hình/tiếng lệch ≤ 0,1 s.

## Sửa

1. `src/shared/utils/video-stream-shortfall.ts` — `detectVideoStreamShortfall`: hình ngắn hơn tiếng quá 3 s → hỏng (trừ khi
   hình khớp thời lượng nền tảng: nguồn có tiếng dài hơn hình); không có tiếng → so với thời lượng nền tảng, dung sai
   max(3 s, 2%) như kiểm tra thời lượng của FileVerifier. Thiếu số đo (MKV/WebM) → không kết luận.
   `DownloadEngine.verifyFinal` gọi nó cho mọi tệp tải mới lẫn tệp dùng lại: hỏng → `DOWNLOAD_VIDEO_STREAM_SHORT`, lỗi
   `DOWNLOAD_FAILED` thử lại được (`details.reason = 'VIDEO_STREAM_SHORT'`), tệp lỗi vào khu cách ly. Đường dùng lại
   (cache/tệp có sẵn) cách ly theo chính lỗi này — tệp hụt hình vẫn qua kiểm tra nhanh nên trước đây sẽ bị dùng lại mãi.
   Tệp đang là nguồn của danh sách khác vẫn giữ nguyên chỗ (S2).
2. `src/shared/utils/ytdlp-notes.ts` — gom dòng cảnh báo/lỗi/thử lại/bỏ qua mảnh/tổng số mảnh (che URL, tối đa 40 dòng);
   tải thành công ghi `YTDLP_OUTPUT_NOTES` (warn nếu có vấn đề, info nếu chỉ có tổng số mảnh).

## Kiểm tra

- Unit `tests/unit/video-stream-shortfall.test.ts`: số đo thật của ca này, mất 1 mảnh 6 s, bản đủ, chênh nhỏ, tiếng dài hơn
  hình theo nguồn, không có tiếng, thiếu số đo; bộ gom lời nhắn.
- Integration `download-existing-file-reuse.test.ts` P4: tải mới hụt hình → lỗi thử lại được + cách ly; tệp hụt hình có sẵn
  → không dùng lại, cách ly, tải bản mới; đối chứng đủ hình; lời nhắn lưu khi tải thành công (warn/info).
