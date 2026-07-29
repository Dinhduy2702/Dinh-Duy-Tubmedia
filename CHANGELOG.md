# Tubmedia 1.2.3

- Sửa Trung tâm cập nhật: ghi chú phát hành dễ đọc và nút đúng trạng thái.
- Tích hợp Dọn dẹp an toàn ổ hệ thống.
- Tích hợp Tải nhanh 1 video và tải theo khoảng thời gian.

# Tubmedia 1.2.0

## Hardening audit 27/07/2026

- Chế độ tải **nguồn cao nhất** mặc định không còn giới hạn 1080p, H.264 hoặc MP4.
- Remux/CapCut không còn xóa tệp MP4 trùng tên; tự tạo tên đầu ra không xung đột.
- Mute-only dùng stream copy, không mã hóa lại video.
- `allowUpscale=false` thực sự không phóng video; mặc định fit + padding và không crop mất nội dung.
- Cleanup chỉ xóa thư mục cache có ownership marker hợp lệ; giữ quarantine và tệp lạ của người dùng.
- Restore bị chặn khi còn queue/process, kiểm tra schema, integrity và foreign key trước commit rồi relaunch.
- State machine backend chặn transition trái phép và không cho job thiếu executor hoàn tất giả.
- Phân tích media phân biệt 10-bit SDR với HDR, bổ sung rotation, SAR/DAR và VFR.
- Tool update từ chối binary không có SHA-256.
- Khôi phục đầy đủ identity/NSIS assets để release gates tự chứa và có thể kiểm tra.

## FIX11 — retry yên lặng, ổ gốc Windows và nhớ đường dẫn

- `JOB_RETRY_SCHEDULED` và `COOKIE_RETRY_SCHEDULED` là trạng thái tự thử lại, chỉ còn trong nhật ký thông tin và không chiếm Trung tâm lỗi cố định.
- Lỗi thật sau khi hết số lần thử vẫn hiện bằng `JOB_FAILED` với toàn bộ chi tiết kỹ thuật.
- Không gọi `mkdir` lên ổ gốc Windows đã tồn tại, sửa `EPERM: operation not permitted, mkdir 'E:\'` khi chọn trực tiếp ổ đĩa.
- Hộp chọn thư mục mở lại tại đúng đường dẫn đang hiển thị trong trường.
- Ghi nhớ riêng đường dẫn tải, tạm, nguồn ghép và thành phẩm giữa các lần mở ứng dụng.
- Danh sách hoặc quy trình mới kế thừa đường dẫn vừa chọn gần nhất thay vì quay về Downloads.

## FIX10 — tự sửa timestamp ghép và hiển thị chi tiết lỗi trong đúng quy trình

- Sửa trường hợp MP4 ghép bằng stream-copy báo thời lượng phi thực tế như 1.507.876 giây dù tổng nguồn chỉ khoảng 4.004 giây.
- Khi xác minh phát hiện timestamp/container bất thường, Tubmedia không quarantine ngay mà remux từng nguồn để đưa timeline về 0, concat lại đúng một lần rồi mới kiểm tra lần cuối.
- Danh sách concat ghi rõ thời lượng dự kiến của từng video để không cộng dồn sai mốc thời gian.
- Bộ phân tích ưu tiên thời lượng luồng video khi duration của container lớn bất hợp lý.
- Kiểm tra mẫu đầu/giữa/cuối dùng thời lượng dự kiến khi metadata đầu ra bị phóng đại, tránh seek đến vị trí không tồn tại.
- JOB_FAILED nay lưu metadata đầy đủ: mã lỗi, giai đoạn, thời lượng dự kiến/thực tế, đường dẫn pending/quarantine và thông tin từng video nguồn.
- Thêm khung “Chi tiết lỗi của quy trình” ngay trong đúng thẻ ghép, luôn hiện thời gian, mã lỗi, mã sự kiện, job ID, nội dung, JSON kỹ thuật và nút sao chép/mở nhật ký.

## FIX6 — lỗi cố định, cookies yên lặng và ghép ổn định

- Thêm Trung tâm lỗi cố định ở góc dưới: luôn giữ lỗi mới nhất, có mã sự kiện, sao chép chi tiết và mở Nhật ký.
- Hiển thị nguyên nhân xác minh thành phẩm chính xác trước khi chuyển tệp vào quarantine.
- Kiểm tra đầu/giữa/cuối bằng ffprobe riêng từng điểm và tự giải mã một frame bằng FFmpeg khi seek packet không ổn định; thử xác minh lại sau khi file được flush.
- GitHub Release API HTTP 403 tự chuyển sang URL chính thức và chỉ ghi log thông tin, không spam cảnh báo.
- Tắt kiểm tra cập nhật ứng dụng tự động mặc định; biểu tượng cập nhật không còn xoay nền, vẫn giữ nút kiểm tra thủ công.
- Mỗi trạng thái có màu riêng; mục Mức xử lý song song dùng tông xanh khi hợp lý.
- Cookies chỉ cảnh báo khi một lần tải thực sự bị chặn; lưu thành công thì đóng yên lặng, không lặp thông báo.
- Gộp thư mục/cấu hình hiệu năng thành 1–2 hàng nhỏ ở cả tải và ghép.
- Thanh cuộn chính giữ lớn; thanh cuộn con ẩn và chỉ hiện khi rê chuột hoặc focus.

## FIX4 – Bundled FFmpeg payload

- Sửa cổng chuẩn bị công cụ chỉ kiểm tra FFmpeg trong PATH nhưng không sao chép vào payload installer.
- Bắt buộc yt-dlp, FFmpeg và FFprobe tồn tại vật lý trong thư mục `tool` trước khi đóng gói.
- Thêm kiểm tra payload và unit test chống tái diễn.
## Tối ưu ghép và chuẩn hóa
- Chuyển sang pipeline chuẩn hóa thông minh: phân tích nguồn song song, chỉ mã hóa clip lệch chuẩn.
- Ghép trực tiếp bằng stream copy khi nguồn tương thích.
- Khi chỉ khác container/timestamp, remux nhanh rồi ghép lại thay vì mã hóa toàn bộ.
- Chuẩn hóa và remux song song theo giới hạn tài nguyên; có cache bền vững theo dấu vân tay tệp.
- Tự chọn NVENC khi FFmpeg đã xác minh encoder, tự quay về CPU nếu runtime GPU lỗi.
- Sửa preset CPU/NVENC để không truyền preset không hợp lệ.
- Giữ đúng tỷ lệ, SAR 1:1 và không tạo viền đen ngoài ý muốn.

## Giao diện và tiến trình
- Thiết kế lại thẻ nhận diện “Phát triển bởi Đình Duy · Tubmedia” với hệ chữ rõ, khoảng cách cân đối và responsive sạch.
- Giữ toàn bộ sửa lỗi tiến trình, tab danh sách/quy trình, tooltip, trạng thái công cụ và nhớ đường dẫn từ 1.1.0.
- Mọi hàng tiến trình đều có icon xóa cố định và hai lựa chọn: chỉ xóa khỏi danh sách hoặc xóa đúng tệp đầu ra.
- Backend từ chối xóa thư mục khi người dùng chọn xóa tệp, tránh thao tác nguy hiểm ngoài ý muốn.

## Phát hành và cập nhật
- Mặc định 2 quy trình ghép đồng thời; cấu hình tài nguyên vẫn cho phép giảm về 1 trên máy yếu.
- Build kiểm tra thực thi yt-dlp, FFmpeg và FFprobe ngay trong payload cài đặt.
- NSIS tự đóng ứng dụng cũ trước khi ghi đè và hỗ trợ `--force-run` từ updater.
- Đóng gói `app-update.yml`; build chính thức tạo `latest.yml` chứa SHA-512 và kích thước installer cho GitHub Releases.

# Tubmedia 1.1.0 — Cập nhật tổng hợp giao diện, tiến trình và hệ thống cập nhật

- Sửa đồng bộ trạng thái hoàn tất, tốc độ không xác định và thứ tự tác vụ.
- Thêm tab riêng cho từng danh sách tải và quy trình tải–ghép.
- Thêm mở rộng chi tiết, nút xóa nhất quán, đường dẫn rút gọn và responsive layout.
- Kế thừa đường dẫn gần nhất khi tạo danh sách hoặc quy trình mới.
- Chỉ hiện nút cập nhật công cụ khi phát hiện phiên bản mới.
- Cấu hình GitHub updater để tạo metadata cập nhật cho các bản sau.
- Giữ toàn bộ hotfix tỷ lệ khung hình của 1.0.1.

# Tubmedia 1.0.1 — Hotfix tỷ lệ khung hình khi ghép

- Sửa lỗi video nguồn đúng tỷ lệ nhưng video ghép bị thu nhỏ và xuất hiện viền đen bốn phía.
- Clip cùng tỷ lệ nhưng khác độ phân giải nay được scale lấp đầy đúng canvas đích, không giữ kích thước nhỏ rồi pad nền đen.
- Clip khác tỷ lệ được scale-to-fill và crop cân giữa thay vì đóng viền đen vào thành phẩm.
- Bổ sung kiểm thử hồi quy cho nguồn 720p ghép vào canvas 1080p và nguồn 4:3 ghép vào canvas 16:9.

# Tubmedia 1.0.0 — Bản ổn định chính thức

- Đồng bộ bài kiểm thử phát hành: `npm run dist` tạo installer chính thức cục bộ qua `dist:official`, còn `release:windows` dành riêng cho gói cập nhật có máy chủ HTTPS, YML và blockmap.
- Chuyển phiên bản từ Release Candidate sang bản ổn định `1.0.0`.
- Giữ nguyên toàn bộ sửa lỗi đã được xác nhận ở RC9: kiểm tra cập nhật phản hồi nhanh, giao diện tiến trình/nhật ký gọn, công cụ tự sửa và installer nâng cấp tại chỗ.
- Installer chính thức dùng tên `Download video Tubmedia-Setup-1.0.0-x64.exe`.
- Gỡ cài đặt chỉ xóa thư mục chương trình, không xóa video thành phẩm hoặc thư mục đầu ra do người dùng chọn.
- Dọn sạch hai cảnh báo NSIS: bổ sung thông tin bản quyền và loại biến Start Menu không dùng.
- Thêm cổng `verify:stable` và lệnh `npm.cmd run dist:official` để build bản phát hành ổn định theo một quy trình duy nhất.
- Khi chưa cấu hình máy chủ HTTPS, Trung tâm cập nhật phản hồi ngay và không giữ giao diện ở trạng thái chờ.

# Tubmedia 1.0.0-rc.9

- Kiểm tra cập nhật của installer thử nghiệm không còn chờ mạng khi chưa có `app-update.yml` hoặc URL máy chủ.
- Giới hạn kiểm tra thủ công tối đa 8 giây và kiểm tra nền tối đa 5 giây.
- Gộp các lượt kiểm tra đồng thời để không gửi nhiều yêu cầu cập nhật trùng nhau.
- Dịch vụ `electron-updater` được nạp lười, chỉ khi thực sự có nguồn cập nhật hợp lệ.
- Nếu máy chủ phản hồi muộn, giao diện thoát trạng thái chờ và kết quả vẫn được theo dõi ở nền.

# Changelog

## 1.0.0-rc.8 — Windows installer version fix

- Chuyển phiên bản SemVer có hậu tố RC sang `VIProductVersion` bốn nhóm số hợp lệ cho NSIS.
- Ví dụ `1.0.0-rc.8` được ghi vào Windows file metadata dưới dạng `1.0.0.8`, trong khi tên installer và phiên bản hiển thị vẫn giữ `1.0.0-rc.8`.
- Thêm kiểm thử và release gate để bản beta/RC sau này không thể làm NSIS lỗi `invalid VIProductVersion format`.
- `dist:nsis-safe` tự sửa và xác nhận bộ công cụ bắt buộc ở chế độ nghiêm ngặt trước khi tạo `win-unpacked`, tránh installer thiếu FFmpeg khi build từ source sạch.

# 1.0.0-rc.6

- Dọn sạch 7 lỗi ESLint còn lại: URL globals, require-await, unused import và consistent type imports.
- Không thay đổi logic tải, ghép, updater, database hay giao diện.

## 1.0.0-rc.4 — Đồng bộ kiểm thử bootstrap công cụ

- Cập nhật bài test khởi động theo API mới `ensureRequiredReady()`.
- Kiểm tra đúng thứ tự: công cụ bắt buộc được kiểm tra/tự sửa trước, công cụ tùy chọn được kiểm tra sau.
- Không thay đổi logic runtime tải, ghép, cập nhật hoặc dữ liệu người dùng.

## 1.0.0-rc.3 — Tự cài công cụ bắt buộc và đóng gói đầy đủ

- `npm run dev` tự kiểm tra và tải `yt-dlp`, `ffmpeg`, `ffprobe` vào thư mục `tool` nếu máy chưa có.
- Mọi thao tác tải/ghép sẽ chờ một lượt sửa công cụ duy nhất thay vì báo lỗi ENOENT ngay.
- Bộ cập nhật công cụ có đường tải trực tiếp chính thức khi GitHub Release API lỗi hoặc bị giới hạn.
- Tải gói công cụ tự thử lại tối đa 3 lần và dọn file tải dở giữa các lần.
- Build installer bắt buộc xác minh `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe` đã được đóng gói; không thể phát hành installer thiếu công cụ.
- PowerShell nhận diện cả công cụ trong `tool` và công cụ đã cài trong PATH.

## 1.0.0-rc.2 — Sửa tương thích Electron Updater ESM/CommonJS

- Sửa lỗi main process không khởi động do named import `autoUpdater` từ gói CommonJS `electron-updater`.
- Chuyển sang cầu `createRequire(import.meta.url)` tương thích ổn định với main process ESM.
- Chỉ nạp updater trong bản đã đóng gói; dev mode không còn tải dependency cập nhật lúc khởi động.
- Nếu updater không thể nạp, ứng dụng vẫn mở bình thường và Trung tâm cập nhật hiển thị trạng thái vô hiệu hóa thay vì làm sập app.
- Bổ sung unit test và release verification chống tái phát lỗi module interop.

# Changelog

## 0.10.1 — Hoàn thiện source test và giữ đúng bitrate khi chuẩn hóa

- Khôi phục đầy đủ `installer/identity.json` và `installer/video-studio-pro.nsi` trong source để kiểm thử nâng cấp và quy trình tạo installer không còn thiếu tệp.
- Giữ nguyên định danh Tubmedia, khóa Registry và cơ chế tự tìm `InstallLocation` khi cập nhật tại chỗ.
- Khi cấu hình giữ dung lượng phải mã hóa lại, dùng bitrate trung bình đã tính từ toàn bộ nguồn ghép thay vì bị tụt về bitrate riêng thấp hơn của một video.
- Bổ sung kiểm tra `verify:v0101` cho định danh installer và chính sách bitrate.

# v0.10.0 — Tải đa nền tảng, giao diện gọn và tự dọn dữ liệu tạm

- Thêm biểu tượng xuất timeline TXT; user tự chọn tên và vị trí bằng hộp thoại Save As.
- Bỏ cơ chế tự sinh timeline phụ trong thư mục thành phẩm.
- Thu gọn thông tin cố định vào disclosure; chuyển thao tác phụ phù hợp thành icon có tooltip/aria-label.
- Mở rộng nhận diện YouTube, Google Drive, TikTok, Facebook, Instagram, X/Twitter, Vimeo, Reddit, Dailymotion, Twitch, SoundCloud và URL generic do yt-dlp hỗ trợ.
- Đánh dấu file bằng mã `[LINK_XXXXXXXXXXXX]`, kiểm tra ffprobe trước khi skip; video trùng tiêu đề nhưng khác link vẫn tải đủ.
- Thêm preset Tải danh sách khuyên dùng bám code tham chiếu: MP4/H.264, 720p–1080p, fallback, aria2c 16 kết nối, 2 fragment và 2 video tải đồng thời toàn app.
- Tách hoàn toàn thiết lập Tải danh sách khỏi nguồn Tải & Ghép.
- Di chuyển `_normalized`, `_quarantine` và concat sang thư mục tạm; thành phẩm MP4 luôn nằm trực tiếp trong output folder user chọn.
- Tự dọn `_normalized`, `_quarantine`, `_yt_tmp`, pending, concat và tệp tải dở sau khi hoàn tất/hủy; khi lỗi giữ clip hợp lệ để thử lại nhanh.
- Dọn thư mục tạm còn sót trong output từ phiên bản cũ ngay khi app khởi động.
- Xóa backup tạm sau khi thay thế thành phẩm atomically thành công.
- Mỗi preset thành phẩm có mục tiêu riêng: ghép nhanh, đồng nhất 1080p, 1440p, 4K/HEVC, theo nguồn, mã hóa nền hoặc CPU tối đa.

# v0.9.8 — Progress Database Crash Fix

- Chặn NaN/Infinity trước khi ghi `queue_jobs.progress`, tránh lỗi `NOT NULL constraint failed`.
- QueueRepository có lớp bảo vệ cuối cùng để progress luôn là số hữu hạn từ 0 đến 100.
- Bỏ qua dòng tiến trình FFmpeg không hợp lệ trong Normalize và Clip.
- Cô lập lỗi callback stdout/stderr để tiến trình media tiếp tục, không làm Electron main process văng.
- Bổ sung test hồi quy database, FFmpeg tracker và callback tiến trình.

# Changelog

## 0.9.7

- Sửa lỗi ghép dừng ở 65% với thông báo `Profile: Main ≠ High`.
- Không còn coi H.264 Profile/Level là điều kiện chặn concat stream-copy.
- Vẫn kiểm tra nghiêm codec, kích thước, FPS, time base, pixel format và cấu trúc âm thanh.
- Trường hợp chỉ khác Main/High sẽ bỏ qua bước mã hóa lại và ghép nhanh bằng `-c copy`.
- Thêm unit test chống tái phát lỗi profile Main/High.

## 0.9.5 — Google Drive tải đúng tệp gốc, không lấy bản preview 200 MB

- Tải & Ghép nhận diện link Google Drive và bắt buộc chọn `format_id=source`, là tệp gốc đã được tải lên Drive.
- Không áp dụng codec, bitrate, độ phân giải hoặc format-sort của Tải danh sách sang Tải & Ghép.
- Nếu Drive không cho phép tải bản gốc, ứng dụng dừng và báo quyền truy cập thay vì âm thầm lấy bản xem trước đã chuyển mã.
- Chính sách cache mới `merge-google-drive-original-source-v5` tự vô hiệu hóa nguồn preview từ các bản cũ.
- Giao diện khuyên dùng cấu hình `Tệp gốc Google Drive · giữ gần dung lượng nguồn`.


## 0.9.3 — Tải H.264/AAC như code tham chiếu và chống 500 MB còn 200 MB

- Tải & Ghép ưu tiên video-only AVC1/H.264 + audio M4A/AAC theo đúng nguyên tắc của code tham chiếu; không lấy nhầm luồng muxed dung lượng thấp.
- Ép container nguồn ghép về MP4 và chỉ remux bằng stream copy, không mã hóa lại sau tải.
- Nâng phiên bản chính sách cache lên `merge-reference-avc-aac-v3`; nguồn cũ chưa đúng chuẩn tự bị loại để tải lại sạch.
- Bổ sung ước lượng dung lượng từ bitrate × thời lượng khi yt-dlp không công bố `filesize`, giúp phát hiện tệp tải nhỏ bất thường.
- Khi buộc phải chuẩn hóa, mỗi video giữ bitrate suy ra từ dung lượng thật của chính nó thay vì dùng một bitrate trung bình thấp áp cho toàn bộ danh sách.
- Đổi cấu hình khuyên dùng thành **Nguyên bản H.264/AAC · giữ gần dung lượng nguồn** và cảnh báo rõ cấu hình 1080p CRF 18 có thể làm tệp nhẹ hơn nhiều.

## 0.9.2 — Giao diện tập trung và thu gọn thông tin cố định

- Thêm một hệ thống hiển thị thông tin thu gọn dùng chung cho trạng thái công cụ, thiết lập tải, khuyến nghị hiệu năng và chất lượng thành phẩm.
- Giữ các nút thao tác quan trọng luôn nhìn thấy; chỉ ẩn phần mô tả, thông số chi tiết và giải thích dài.
- Tự mở chi tiết khi công cụ lỗi hoặc cấu hình có nguy cơ hạ độ nét.
- Bỏ mô tả phụ lặp lại ở sidebar, chân sidebar, topbar và tiêu đề từng danh sách/quy trình.
- Gộp ba thẻ chất lượng trong mỗi quy trình ghép thành một khu duy nhất.
- Cân lại khoảng cách, chiều cao topbar, sidebar, khu tiến trình và bố cục responsive.

## 0.9.1 — Chặn giảm dung lượng nguồn và cân lại logo góc trái dưới

- Tách bộ chọn nguồn cao nhất thành `bv+ba/b` và ưu tiên rõ độ phân giải, FPS, dung lượng, bitrate.
- Xác minh dung lượng thực sau tải với format mà yt-dlp đã chọn.
- Vô hiệu cache chất lượng cũ của cả Tải danh sách và Tải & Ghép.
- Chặn thành phẩm giữ nguồn khi dung lượng giảm bất thường.
- Chuyển thiết lập tải danh sách mặc định sang cao nhất theo nguồn, không giới hạn.
- Thiết kế lại thẻ nhận diện nhà phát triển ở chân sidebar với logo và chữ lớn, cân đối hơn.

## 0.9.0 — Nguồn ghép nguyên chất lượng, mở giao diện nhanh và cập nhật ghi đè

- Tách chính sách tải video nguồn của **Tải & Ghép** khỏi thiết lập tải danh sách toàn cục; chế độ CapCut, giới hạn codec, độ phân giải và bitrate không còn làm giảm nguồn trước khi ghép.
- Tách khóa nguồn/cache theo từng danh sách và từng quy trình trong SQLite. Cùng một link ở **Tải danh sách** và **Tải & Ghép** không còn trỏ vào cùng một bản video; từng lane cũng giữ lịch sử và tệp nguồn riêng.
- Tách rõ hai khu cài đặt thành **Tải danh sách** và **Tải & Ghép**. Cấu hình đầu ra, nhận diện tệp có sẵn và dấu chất lượng không được dùng chéo; chỉ cookies, mạng và các executable yt-dlp/FFmpeg dùng chung.
- Video nguồn cho quy trình ghép luôn chọn bản tốt nhất theo thứ tự độ phân giải, FPS, bitrate và kích thước; giữ video/audio nguồn rồi chỉ chuẩn hóa một lần ở bước ghép khi thật sự cần.
- Lưu dấu `merge-best-source-v1` trong SQLite. Cache từ bản cũ chưa có dấu này được giữ an toàn trong khu cách ly trong lúc tải lại; khi nguồn mới hợp lệ, bản cũ tự được dọn để không chiếm thêm dung lượng.
- Đổi mặc định thành **Giữ nét và dung lượng gần nguồn**; giao diện nói rõ cấu hình chất lượng tại trang Tải & Ghép chỉ áp dụng cho thành phẩm cuối.
- Bootstrap không còn chờ sửa công cụ, đọc 300 dòng log và dò phần cứng Windows đầy đủ mới mở giao diện. Dữ liệu local và cấu hình máy cơ bản hiển thị trước; lịch sử, phần cứng đầy đủ và kiểm tra công cụ tiếp tục ở nền.
- Kiểm tra ba công cụ bắt buộc trước để mở hàng đợi; ffplay và aria2c được kết nối tiếp ở nền.
- Cố định app ID, product name và khóa Registry của installer. Khi phát hiện Tubmedia đã cài, installer tự dùng `InstallLocation` cũ, bỏ trang chọn thư mục và ghi đè đúng ứng dụng cũ.
- Hỗ trợ chuyển tại chỗ từ định danh cũ `com.duyy.video-download-merge-studio-pro`; Windows chỉ còn một mục gỡ cài đặt Tubmedia.
- Thêm `npm.cmd run dist:source-update` để tạo ZIP cập nhật có `package.json`, `src` và các thư mục code ngay ở gốc, không bọc trong thư mục tên phiên bản.

## 0.8.9 — Tạm dừng Windows an toàn khi PID đang kết thúc

- Nhận diện NTSTATUS `-1073741558` (`0xC000010A`, `STATUS_PROCESS_IS_TERMINATING`) và `-1073741813` (`STATUS_INVALID_CID`) là xung đột thời điểm khi tiến trình vừa tự kết thúc, không còn làm IPC `workbench:pause` báo lỗi.
- Tiếp tục bỏ qua an toàn lỗi mở PID Windows `87/1168`.
- Nếu tiến trình cha biến mất sau khi tiến trình con vừa bị suspend, tự resume các tiến trình con đã điều khiển để không để lại FFmpeg/aria2c treo mồ côi.
- Xếp hàng tuần tự lệnh pause/resume cho từng tiến trình và bỏ qua lệnh trùng trạng thái, tránh suspend-count bị cộng nhiều lần khi thao tác nhanh.
- Thêm kiểm thử hồi quy cho đúng PID `42624`, mã lỗi thực tế và script điều khiển cây tiến trình.

## 0.8.8 — Copy từng mốc, theo dõi dung lượng và chống nén thành phẩm quá mạnh

- Mỗi dòng timeline có nút Copy riêng đặt trước mốc; clipboard chỉ nhận đúng `00:00 Ph`, không kèm `Video_001`.
- Bỏ nút copy toàn bộ timeline để user chủ động lấy đúng mốc cần dùng.
- Thêm bảng dung lượng trực tiếp cho từng quy trình: video nguồn đã tải, dữ liệu xử lý tạm hiện còn, video thành phẩm và tổng ba giai đoạn.
- Tự cảnh báo khi thành phẩm nhỏ hơn 55% tổng video nguồn, giúp phát hiện cấu hình đang nén lại quá mạnh.
- Thêm cấu hình **Giữ nét và dung lượng gần nguồn**: stream-copy khi tương thích; khi phải mã hóa lại, dùng bitrate trung bình có trọng số theo thời lượng của toàn bộ nguồn.
- Thêm nút chọn nhanh cấu hình giữ dung lượng khi ứng dụng phát hiện tệp 6–7 GB bị nén xuống khoảng 1–2 GB.
- Cho phép cấu hình tùy chỉnh chọn giữa CRF/CQ và bitrate trung bình nguồn.

## 0.8.7 — CapCut SDR 1080p–2K, timeline gọn và chống giảm nét

- Thêm chế độ tải trực tiếp cho CapCut ở 1080p hoặc 1080p–2K/1440p, MP4 H.264 High, AAC 48 kHz, yuv420p 8-bit, SDR BT.709 và tối đa 60 FPS.
- Nhận diện HDR/10-bit/BT.2020/PQ/HLG và tone-map bằng zscale + Hable chỉ khi user chủ động chọn chế độ CapCut; không tạo tệp Proxy.
- Dùng lại được cache nguồn 4K rồi hạ đúng xuống 2K thay vì tải lại; nguồn dưới 1080p bị báo rõ và không phóng lớn giả.
- Timeline mặc định được lưu trong tiến trình để xem/copy trên giao diện; chỉ tạo `.timeline.txt` khi user bật lựa chọn và loại bỏ hoàn toàn đầu ra CSV/JSON.
- Nút copy chỉ sao chép các dòng `00:00 Ph Video_001`, không kèm tiêu đề, ghi chú hoặc đường dẫn.
- Sửa chuẩn hóa merge để quyết định stream-copy riêng cho video/audio; chỉ audio lệch thì không mã hóa lại video.
- Bổ sung preset 1080p đúng thông số hình của `DownloadAndConcat(2).ts` và hướng dẫn trực tiếp khi cấu hình có nguy cơ hạ độ nét.
- Dọn tệp trung gian do Tubmedia/yt-dlp/aria2/FFmpeg tạo sau khi hoàn tất, nhưng không xóa tệp tùy ý của user trong thư mục tạm.

## 0.8.6 — Luồng ghép độc lập, tiến trình đầy đủ và khôi phục tải cookies

- Tách lane tải danh sách khỏi lane tải–ghép; nguồn của quy trình ghép có worker và giới hạn riêng nên vẫn tải song song khi các danh sách tải đang bận.
- Bổ sung thanh tiến trình ghép riêng với giai đoạn phân tích, đối chiếu tương thích, chuẩn hóa, ghép FFmpeg, kiểm tra thành phẩm và xuất timeline.
- Tiến trình ghép hiển thị phần trăm, tốc độ `x`/FPS, thời gian đã chạy, ETA, thời lượng đã xử lý và vị trí video hiện tại.
- Giữ thanh hoàn tất đứng yên ở 100%; chỉ trạng thái thực sự xử lý mới có vệt sáng.
- Tối ưu tải theo bản code tham chiếu: aria2c 16 kết nối, 2 fragment đồng thời, chunk 10 MB, retry 60/60/30, fallback yt-dlp thường và cập nhật giao diện 300 ms.
- Dùng kiểm tra FFprobe tiêu chuẩn mặc định thay cho giải mã toàn bộ video để giữ tốc độ; kiểm tra chuyên sâu vẫn có thể bật thủ công.
- Một video cần cookies không còn tạm dừng hoặc gán lỗi cho toàn bộ link phía sau; các video khác vẫn tiếp tục tải.
- Tự gỡ trạng thái cookies bị sao chép hàng loạt từ dữ liệu v0.8.5, nhưng giữ nguyên video đã được xác nhận thật sự cần xác thực.
- Phân biệt cookies chưa có với cookies đã hết hạn/không còn được chấp nhận và thông báo rõ cho user.
- Hỗ trợ cookies Netscape, JSON xuất từ trình duyệt và chuỗi Cookie `name=value; ...`; tệp được chuẩn hóa trước khi truyền cho yt-dlp.
- Bỏ qua an toàn lỗi Windows PID 87 khi tiến trình vừa kết thúc trước lệnh tạm dừng; không còn Promise rejection không được xử lý.
- Mọi lỗi cuối cùng của tải, xử lý hoặc ghép đều phát thông báo 3 giây và giữ chi tiết tại trang Tiến trình/nhật ký.

## 0.8.5 — Dừng hiệu ứng thanh tiến trình đã hoàn tất

- Chỉ chạy vệt sáng khi video thực sự đang phân tích, tải, xác minh, xử lý hoặc ghép.
- Video `Đã hoàn tất` và `Đã tải trước đó – đã bỏ qua` giữ thanh tiến trình đứng yên ở 100%.
- Thanh tạm dừng, chờ, lỗi và đã hủy cũng đứng yên để trạng thái trên giao diện phản ánh đúng hoạt động nền.
- Áp dụng đồng nhất tại trang Tiến trình, chi tiết Dự án, danh sách tải và quy trình tải–ghép.

## 0.8.4 — Cookies tự đóng và thông báo 3 giây

- Mọi thông báo nổi, gồm thông tin, thành công, cảnh báo và lỗi, tự đóng sau đúng 3 giây.
- Sau khi xác nhận một trong ba cách thêm cookies, hộp Cookies luôn đóng dù bước tiếp tục hàng đợi phát sinh lỗi riêng.
- Xóa thông báo lỗi xác thực cũ ngay khi cookies đã được xác nhận.
- Bảng hướng dẫn cookies chỉ còn hiện khi tác vụ thực sự đang bị chặn.
- Khi tác vụ chuyển sang chờ chạy lại, mã xác thực nội bộ vẫn được giữ để yt-dlp gắn cookies nhưng bảng cảnh báo cũ biến mất ngay.
- Hành vi được áp dụng giống nhau cho danh sách tải và quy trình tải–ghép.

## 0.8.3 — Bỏ qua video đã tải, UTF-8 và tiến trình gọn

- Ép yt-dlp xuất UTF-8 bằng đối số chính thức và môi trường Python UTF-8 để giữ nguyên tiêu đề, uploader và đường dẫn tiếng Việt.
- Dọn metadata/tên tiến trình chứa ký tự thay thế Unicode do phiên bản cũ lưu sai.
- Tự khôi phục tác vụ `TOOL_NOT_FOUND`/`TOOL_HEALTH_CHECK_FAILED` khi ba công cụ bắt buộc đã sẵn sàng; giữ nguyên các lỗi không liên quan.
- Nhận diện tệp có sẵn theo source/link và media ID; luôn xác minh file trước khi bỏ qua.
- Tệp hỏng hoặc tải dở không được đánh dấu bỏ qua; ứng dụng đưa tệp vào khu cách ly rồi tải lại.
- Lưu trạng thái `skipped`, thông báo `Đã tải trước đó – đã bỏ qua` và đường dẫn đầu ra vào đúng dòng tiến trình.
- Màn hình danh sách chỉ giữ một thanh tổng; trang Tiến trình hiển thị chi tiết các video chạy song song.

## 0.8.2 — Đồng bộ trạng thái công cụ và khóa hàng đợi an toàn

- Chỉ khôi phục hàng đợi sau khi bước tự dò/tự sửa công cụ lúc khởi động hoàn tất.
- Thêm cổng thực thi dùng chung: tác vụ nền chưa được phép chạy khi yt-dlp, FFmpeg hoặc ffprobe chưa sẵn sàng.
- Tuần tự hóa mọi health check để loại bỏ tình trạng nhiều phép kiểm tra đồng thời ghi đè trạng thái tốt.
- Giảm kiểm tra thừa trước khi tải và chỉ quét lại ba công cụ bắt buộc khi cần.
- Chuẩn hóa đường dẫn executable được nhập có dấu ngoặc kép.
- Nhận diện khả năng riêng cho yt-dlp, ffprobe, ffplay và aria2c bằng lệnh an toàn của từng công cụ.
- Sửa nội dung cảnh báo để nêu đúng công cụ lỗi và trạng thái hàng đợi.

## 0.8.1 — Sửa PNG cũ và timeline đúng định dạng dựng

- Bổ sung lại `tubmedia-app-icon.png` hợp lệ để ghi đè tệp hỏng còn sót khi người dùng giải nén source mới vào thư mục phiên bản cũ.
- Timeline TXT dùng đúng mẫu `00:00 Ph Video_001` của quy trình ghép gốc.
- Lưu toàn bộ mốc timeline thực vào tác vụ ghép và xuất chúng trực tiếp trên giao diện sau khi hoàn tất.
- Giao diện phân biệt rõ timeline xem trước (`--:--`) với thời gian thực đã đo bằng ffprobe.
- CSV/JSON giữ metadata đầy đủ trong khi TXT vẫn gọn, tương thích với quy trình dựng hiện tại.

## 0.8.0 — Logo vector, tiến trình thật và đầu ra sản phẩm

- Loại bỏ asset logo giao diện bị hỏng; dùng một hệ logo SVG/vector cho loading, sidebar, thông tin và chữ ký.
- Sửa luồng yt-dlp để không bị `--print` làm mất tải thật hoặc luồng tiến trình.
- Tự sửa công cụ bắt buộc lúc khởi động trên Windows x64.
- Tên video lấy từ metadata nguồn; tiến trình từng video và đường dẫn tệp được lưu vào hàng đợi.
- Tách đầu ra timeline theo tên sản phẩm, tránh ghi đè giữa nhiều quy trình.
- Bỏ trường tên quy trình ghép khỏi giao diện; tên sản phẩm là nguồn tên duy nhất.
- Throttle cập nhật tiến trình để giảm ghi SQLite và giảm giật giao diện.

## 0.7.0 — Nhận diện Tubmedia và giao diện chuyên nghiệp

- Thay icon Desktop, cửa sổ, taskbar, khay hệ thống và trình cài đặt bằng biểu tượng Tubmedia đỏ–trắng nền trong suốt; loại bỏ hoàn toàn viền đen và tạo đủ kích thước ICO cho Windows.
- Thiết kế lại toàn bộ giao diện theo hệ màu Tubmedia đỏ, trắng và trung tính; phân cấp nội dung, khoảng cách, card, biểu mẫu, bảng dữ liệu và trạng thái rõ ràng hơn.
- Sắp xếp lại nhóm nút theo hành động chính, hành động hỗ trợ và thao tác nguy hiểm; các nút xóa được tách màu để giảm bấm nhầm.
- Bổ sung thanh điều hướng dạng dock ở đáy cho cửa sổ hẹp, bố cục thích ứng cho máy tính bảng/cửa sổ nhỏ và vùng chạm tối thiểu phù hợp.
- Thêm chuyển cảnh trang, hiệu ứng trạng thái, tiến trình và hover mượt; tự động tắt chuyển động khi Windows bật chế độ giảm chuyển động.
- Sửa Tạm dừng/Tiếp tục trên Windows bằng điều khiển trực tiếp cả cây tiến trình yt-dlp/FFmpeg; chỉ đổi trạng thái giao diện sau khi hệ điều hành xác nhận thành công.
- Tạm dừng/Tiếp tục từng danh sách và toàn ứng dụng nay chờ kết quả thật, cập nhật theo lô và tránh phát sự kiện giao diện lặp lại.
- Xóa toàn bộ dọn cả dự án ẩn, dữ liệu con, tác vụ không gắn dự án và nhật ký cũ trong SQLite; bổ sung kiểm thử hồi quy.
- Hoàn thiện thêm các nhãn tiếng Việt và sửa nhận diện sai chế độ cookies dán trực tiếp.

## 0.6.3 — Tự kết nối, lưu bền vững và điều khiển toàn ứng dụng

- Tự động nhận diện, kiểm tra và kết nối yt-dlp, FFmpeg, ffprobe, ffplay và aria2c ngay khi mở ứng dụng; giao diện khởi động chờ kết quả thật trước khi báo sẵn sàng.
- Đồng bộ trạng thái công cụ từ tiến trình chính sang toàn bộ giao diện; nút kiểm tra thủ công chỉ còn là lựa chọn kiểm tra lại.
- Tự động lưu cấu hình và nội dung liên kết của từng danh sách tải/quy trình ghép sau khi chỉnh sửa.
- Chế độ nhập thay thế xóa cả mục liên kết và lô nhập cũ trước khi ghi dữ liệu mới, ngăn dữ liệu đã xóa quay lại sau khi mở ứng dụng.
- Xóa từng khu vực sẽ dọn mọi bản ghi cũ/trùng mã từ các phiên bản trước; xóa toàn bộ sẽ xóa cả dự án đang hoạt động, ẩn và đã lưu trữ trong cơ sở dữ liệu nhưng giữ nguyên video trên ổ đĩa.
- Thêm Tạm dừng tất cả, Tiếp tục tất cả và Dừng rồi xóa toàn bộ; các lệnh áp dụng đồng thời cho mọi danh sách tải và mọi quy trình tải–ghép.
- queue:remove chuyển thành thao tác bảo vệ không phát sinh exception khi tác vụ chưa đủ điều kiện xóa, chấm dứt spam log Electron.
- Tiếp tục giữ cookies theo yêu cầu: không đọc hoặc gắn cookies khi mở ứng dụng hay khi tải video công khai.
- Việt hóa các thông báo, trạng thái, nguồn công cụ, nhãn điều khiển và trình cài đặt NSIS.

## 0.6.2

- Thay icon cửa sổ, taskbar, tray và installer bằng biểu tượng Play đỏ lấy từ logo Tubmedia do người dùng cung cấp.
- Sidebar và trang Thông tin dùng đúng wordmark Tubmedia, có biến thể sáng/tối theo giao diện Windows.
- Giữ nguyên cơ chế cookies on-demand của 0.6.1 và toàn bộ backend tải/ghép.

## 0.6.1

- Cookies chuyển sang chính sách on-demand: tải công khai trước, chỉ gắn cookies khi video thật sự yêu cầu xác thực.
- Không tự hiện thông báo cookies khi mở ứng dụng.
- Tự retry kín đáo bằng cookies đã cấu hình trước khi yêu cầu người dùng thao tác.
- Giữ marker cần cookies khi Resume để đúng job tiếp tục bằng thông tin đăng nhập mới.

## 0.6.0 — Tubmedia Red/White Responsive UI

- Đổi tên sản phẩm và file cài đặt thành **Download video Tubmedia**.
- Logo Tubmedia đỏ/trắng trở thành nhận diện chính của cửa sổ, sidebar, About, tray và installer.
- Giao diện sáng/tối tự động theo Windows; vẫn cho phép chọn thủ công trong Cài đặt.
- Thiết kế lại shell, sidebar, topbar, button, form, card, progress, dialog và toàn bộ workflow.
- Sửa tràn/vỡ layout bằng grid tự co giãn, min-width an toàn và breakpoint mới.
- Thiết kế lại Trung tâm công cụ với card gọn, path không tràn, action 2x2 và trạng thái CPU/NVENC riêng.
- Thiết kế lại chữ ký **Đình Duy / Tubmedia** theo phong cách đỏ sang trọng.
- Giữ nguyên backend tải, ghép, cookies, queue, database và CPU fallback của 0.5.1.
- Giữ quy trình NSIS an toàn cho Windows PowerShell 5.1 và sửa UninstallString.

## 0.5.1

- Đặt CPU tự động làm encoder mặc định an toàn.
- H.264 dùng libx264, HEVC dùng libx265.
- Health Check giữ lại trạng thái NVENC runtime không khả dụng để giao diện giải thích rõ.
- Ép NVENC nhưng không khả dụng sẽ tự fallback CPU.
- NVENC lỗi giữa tác vụ sẽ tự retry một lần bằng CPU.
- Resource Profile mặc định và đề xuất theo máy dùng GPU jobs = 0.
- Thêm unit test cho bộ chọn encoder.

## 0.5.0

- Thiết kế giao diện Aurora sáng, hiện đại, responsive; bổ sung animation và vẫn tôn trọng Reduce Motion.
- Thêm Tool Readiness dùng chung trên cả màn hình Tải nhiều danh sách và Tải & Ghép.
- Xác nhận backend hai workflow dùng cùng một ToolManager và đều chạy preflight yt-dlp/FFmpeg/ffprobe trước khi bắt đầu.
- Thêm xóa hoàn toàn từng danh sách hoặc pipeline khỏi ứng dụng, giữ nguyên media/thành phẩm trên ổ đĩa.
- Thêm xóa từng dòng tiến trình và dọn hàng loạt lịch sử Completed/Skipped/Cancelled/Failed an toàn.
- Bảo vệ tác vụ đang chạy và dependency chưa kết thúc khỏi thao tác dọn lịch sử.
- Thêm hộp xác nhận có trạng thái xử lý cho các thao tác xóa.
- Làm mới Sidebar, Topbar, Trung tâm công cụ và trang Giới thiệu.
- Hiển thị nhà phát triển Đình Duy Tubmedia trong ứng dụng và metadata package.
- Đổi theme mặc định của cài đặt mới sang Light; người dùng cũ vẫn giữ theme đã lưu.

## 0.4.0

- Tách hoàn toàn 1–4 danh sách tải và 1–4 pipeline tải-ghép.
- Mỗi khu vực có form, nút theo trạng thái, progress, lỗi và log riêng.
- Bổ sung xóa lịch sử tiến trình và nhật ký theo từng khu vực hoặc toàn ứng dụng.
- Thêm Attention Center nổi bật, spinner/loading state và thông báo thành công cho các thao tác chính.
- Thêm ba cách cookies: trình duyệt, dán trực tiếp Netscape và file TXT.
- Chuyển lỗi Chrome/Edge cookie database lock thành thông báo tiếng Việt có bước xử lý.
- Khóa trường cấu hình của job đang chạy/tạm dừng để tránh hiểu nhầm khi Resume.
- Tách 1–4 pipeline ghép, mỗi pipeline nhận số video tùy ý và Quality Profile độc lập.
- Gỡ menu native File/Edit/View/Window, ẩn menu bar và hoàn thiện animation/responsive/reduced-motion.
- Bổ sung feedback cho lưu cài đặt, kiểm tra máy, tạo/áp dụng khuyến nghị và chọn thư mục.

## 0.3.0

- Chuyển màn hình tải từ hai lane cố định sang 1–4 danh sách động.
- Tách riêng output, temp, queue, progress, lỗi và log cho từng danh sách.
- Thêm scheduler round-robin công bằng giữa các danh sách và giới hạn worker toàn ứng dụng.
- Thêm đề xuất worker theo CPU, RAM, loại ổ đĩa, số list và trạng thái Deep verification.
- Thêm giới hạn chất lượng tải min/max cho resolution, FPS, video bitrate và audio bitrate.
- Thêm codec/container preference và tùy chọn strict/fallback khi nguồn dưới mức tối thiểu.
- Thêm kiểm tra chất lượng bằng ffprobe sau tải và kiểm tra toàn bộ file bằng FFmpeg từ đầu đến cuối.
- File lỗi hoặc không đạt giới hạn bắt buộc được đưa vào quarantine.
- Thêm UI cookies.txt/Chrome/Edge/Firefox tại Settings, Preflight và thẻ lỗi của từng list.
- Lỗi cookies, tool, ổ đĩa hoặc quyền truy cập chỉ Pause list liên quan.
- Thêm circuit breaker cho lỗi mạng/CDN lặp lại để tránh spam hàng loạt lỗi.
- Ghi log vật lý riêng theo project/list và thêm bộ lọc list trong trang Nhật ký.
- Diagnostic bundle bao gồm log, phần cứng, tool, cấu hình đã làm sạch, project và job.
- Giữ Portable Tool Manager, cập nhật/repair/rollback tool từ v0.2.2.

## 0.2.2

- Tự nhận thư mục portable `tool` cạnh source/app.
- Thêm Health Check cho `ffplay`.
- Thêm Sửa chữa tất cả, Cập nhật tất cả, mở folder tool và rollback theo package.
- Cập nhật FFmpeg/ffprobe/ffplay đồng bộ cùng một bộ.
- Backup, kiểm tra file mới, Health Check sau cài và rollback tự động.
- Đóng gói folder `tool` vào installer.

## 0.2.1

- Thêm phát hiện cookies và Pause queue theo danh sách.
- Thêm worker tổng toàn ứng dụng, fragment và aria2c connections.
- Thêm kiểm tra cấu hình máy và đề xuất hiệu năng.

## 0.2.0

- Thay UX project-first bằng hai workflow trực tiếp.
- Thêm hai lane download A/B chạy song song, output độc lập.
- Thêm WorkbenchService và IPC contract chuyên biệt.
- Thêm fair scheduler theo lane và per-lane worker limit.
- Thêm source cache materialization giữa hai folder.
- Thêm remux MP4 không giảm chất lượng khi khả dụng.
- Smart Merge chọn source canvas thật lớn nhất và FPS cao nhất, không tạo canvas giả.
- Thêm Renderer Error Boundary và màn hình bootstrap error.

## 1.0.0-rc.1 — Release candidate chuyên nghiệp

- Tối ưu renderer bằng batching tiến trình/log/queue, lazy route, bỏ StrictMode trong dev và giảm polling khi cửa sổ ẩn.
- Thiết kế lại thông báo với enter/exit hai frame, thời gian theo mức độ, pause khi hover và lỗi quan trọng không tự biến mất.
- Hoàn thiện giao diện nền đen ánh đỏ và trắng ánh đỏ; giảm backdrop-filter/animation nặng khi xử lý media.
- Thêm Trung tâm cập nhật dùng electron-updater: kiểm tra định kỳ, tải nền, chặn cài khi đang chạy tác vụ và sao lưu trước nâng cấp.
- Chuyển release production sang electron-builder NSIS có latest/beta metadata và blockmap cập nhật vi sai.
- Giữ nguyên appId/GUID để nâng cấp tại chỗ và giữ userData.
- Queue dùng scheduler không chồng tick, giảm polling khi rảnh và bỏ thông báo DISK_FULL trùng lặp.
- Ngăn Windows ngủ trong lúc có tác vụ thực sự chạy; tự trả chế độ ngủ khi hàng đợi rảnh.
- Dọn file log theo retention và chỉ giữ 5 backup tự động gần nhất trước cập nhật.
- Tăng cường sandbox: từ chối permission web và chặn webview.
