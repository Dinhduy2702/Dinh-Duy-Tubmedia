# FIX19 — Bộ ffmpeg chép tay vào tools\current không được ưu tiên hơn ffmpeg đi kèm bộ cài

## Vụ việc (máy khách, 2026-10-15)

Job ghép `03002b08…` ("Hậu maxhunter 21 10 26") bị hậu kiểm chặn vì tiếng AAC hỏng ở 11:05 (nguồn #2 NA361). Đã chốt:

- App dùng `%APPDATA%\video-download-merge-studio-pro\tools\current\ffmpeg.exe` = **ffmpeg 8.0 essentials (gyan.dev)**.
  Ba tệp ffmpeg/ffprobe/ffplay trùng từng byte với bản phát hành chính thức (98.730.496 / 98.532.352 / 100.213.760).
- Bộ mã hóa AAC của bản đó tạo gói tiếng hỏng với NA361 ở `-c:a aac -b:a 256k -ar 48000 -ac 2` (tái hiện trên máy dev
  bằng đúng bản 8.0: `[aac] error in spectral data, ESC overflow`). ffmpeg đi kèm bộ cài 1.6.3 (build 2026-10-11) và 8.1.2
  cho tiếng sạch.
- Bản 8.0 được đặt vào `tools\current` ngày 25/07/2026 từ ngoài app: không có `.vdmsp-tool-metadata.json`, giờ sửa
  12/06/2026 trùng bộ công cụ tự tải dùng ngoài app; không phiên bản app nào tải bản gyan.dev (trình cập nhật chỉ dùng BtbN).
- Khách cài đè 1.3.0 → 1.6.3: bộ cài không đụng userData, và `ToolManager` xếp `tools\current` (managed) TRƯỚC công cụ đi
  kèm bộ cài → app cứ dùng bản 8.0, không dùng ffmpeg mới của bộ cài.

## Sửa

- `ToolManager.resolveCandidates`: với ffmpeg/ffprobe/ffplay, bản trong `tools\current` chỉ được xếp trước bản đi kèm bộ
  cài khi `.vdmsp-tool-metadata.json` có mục `ffmpeg-suite` (trình cập nhật của app đã cài). Không có / metadata hỏng →
  xếp SAU bản đi kèm bộ cài (vẫn là dự phòng nếu bộ cài không có ffmpeg). yt-dlp/aria2c giữ nguyên thứ tự (trình cập
  nhật trước 1.2.3 cài yt-dlp mà không ghi metadata; không được hạ ưu tiên bản yt-dlp mới hơn).
- `ToolUpdateService.updatePackage`: ghi metadata TRƯỚC bước kiểm sau cập nhật (trước đây ghi sau → với quy tắc trên, bước
  kiểm chọn nhầm bản đi kèm bộ cài và app không dùng bản vừa cài cho tới lần kiểm sau). Cập nhật thất bại → khôi phục
  metadata cũ cùng với tệp cũ.

## Kiểm tra

- Unit `tool-manager-managed-ffmpeg-trust.test.ts` (ToolManager thật, tools\current giả lập): không metadata → bản đi kèm
  bộ cài trước, bản kia làm dự phòng; metadata chỉ có aria2c; ffprobe/ffplay; metadata hỏng → đỏ trên mã cũ. Metadata có
  ffmpeg-suite, không có bản đi kèm bộ cài, yt-dlp/aria2c → giữ như cũ.
- Unit `tool-update-managed-metadata-order.test.ts` (ToolUpdateService + ToolManager thật, chỉ giả tải/giải nén): cập nhật
  xong app dùng ngay bản vừa cài (mã cũ: đỏ — dùng bản đi kèm bộ cài); kiểm sau cập nhật thất bại → tệp cũ và metadata cũ
  được khôi phục (bỏ đoạn khôi phục thì đỏ).
