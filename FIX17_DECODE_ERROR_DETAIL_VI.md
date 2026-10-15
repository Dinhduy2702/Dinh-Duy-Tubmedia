# FIX17 — Hậu kiểm ghi nguyên câu lỗi của ffmpeg và nói rõ luồng hình hay luồng tiếng

## Vụ việc (máy khách, 2026-10-15)

Job ghép `03002b08…`, sản phẩm "Hậu maxhunter 21 10 26", 8 nguồn, dài 3949 giây. Hậu kiểm toàn bộ dừng ở 17% và app báo:

> Tubmedia đã CHẶN thành phẩm vì phát hiện lỗi hình ảnh tại khoảng 00:11:05. Lỗi giải mã hình ảnh khi hậu kiểm toàn bộ
> thành phẩm, gần 00:11:05. Video nguồn liên quan: #2 – NA361_TA.mp4.

Log không có câu lỗi của ffmpeg. Phải nhờ khách chạy lại ffmpeg bằng tay mới biết câu lỗi thật:

```
[aac @ …] error in spectral data, ESC overflow
[aist#0:1/aac @ …] [dec:aac @ …] Error submitting packet to decoder: Invalid data found when processing input
```

Tức lỗi ở **luồng tiếng**, không phải hình. Lệnh hậu kiểm giải mã cả tiếng (`-map 0:a:0`, `-xerror -err_detect explode`),
nên lỗi tiếng cũng làm ffmpeg dừng, nhưng app luôn gọi là "lỗi hình ảnh".

## Sửa

- `src/shared/utils/ffmpeg-decode-failure.ts`
  - `describeFfmpegDecodeFailure(stderr)`: giữ các câu lỗi gốc (bỏ dòng thông tin, dòng blackdetect/freezedetect), tối đa
    1.500 ký tự (luôn giữ câu lỗi đầu tiên + phần cuối), và nhận ra luồng: `[aist#…]`/`[vist#…]` (ffmpeg 7+), hoặc tên
    bộ giải mã (`[aac @`, `[h264 @`…) với ffmpeg cũ. Không nhận ra → `null`.
  - `blockedOutputProblemLabel(issue)`: "lỗi âm thanh" khi vấn đề đầu tiên là lỗi giải mã luồng tiếng, còn lại giữ
    "lỗi hình ảnh".
- `FileVerifier.verifyVisualIntegrity`: vấn đề `decode` có thêm `stream` (`video`/`audio`/`null`) và `ffmpegError`
  (nguyên văn); thông báo nói "Lỗi giải mã âm thanh …" khi lỗi ở tiếng.
- `MergeEngine`: câu "Tubmedia đã CHẶN thành phẩm vì phát hiện …" dùng `blockedOutputProblemLabel`.
- Hai trường mới nằm trong `visualIssues` của `details`, nên tự vào dòng `JOB_FAILED` của `queue.log` và log danh sách.

## Kiểm tra

- Unit `ffmpeg-decode-failure.test.ts`: dùng nguyên văn stderr của khách (audio), một stderr h264 (video), ffmpeg cũ,
  không rõ luồng, cắt độ dài, stderr rỗng, và câu thông báo chặn.
- Integration `visual-verify-decode-detail.test.ts`, chạy ffmpeg thật: clip có 40 gói AAC bị ghi đè (hình sạch, tiếng hỏng
  — đúng kiểu của khách) → `stream = 'audio'`, `ffmpegError` chứa câu lỗi aac, thông báo nói "âm thanh". Clip sạch → không
  có vấn đề decode. Mã cũ: đỏ.
