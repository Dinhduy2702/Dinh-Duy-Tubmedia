# Download video Tubmedia 1.2.8

Ứng dụng desktop Windows tập trung vào hai workflow:

1. **Tải linh động 1–4 danh sách video độc lập** — mỗi danh sách có link, output, temp, worker, queue, lỗi và log riêng.
2. **Tải danh sách và ghép thành một video** — dùng một tên sản phẩm duy nhất, giữ đúng thứ tự đầu vào, tạo clip timestamp khi cần, chuẩn hóa thông minh và xuất MP4. Timeline luôn xem/copy trên giao diện; nhấn biểu tượng Xuất TXT để tự chọn tên và nơi lưu.

Đây là Electron application cho PC. Renderer React chỉ hiển thị giao diện; filesystem, SQLite, yt-dlp, FFmpeg, queue và process đều chạy trong Electron Main qua typed IPC. Production tải asset local, không chạy Express/Fastify và không mở web server.

## Giao diện chính

- **Tải nhiều danh sách**: thêm/bớt từ 1 đến 4 list, mỗi list lưu ở nơi khác nhau, có một thanh tiến trình tổng và log riêng.
- **Tải & Ghép**: nhập danh sách theo đúng thứ tự, chọn thư mục, tên sản phẩm, cấu hình chất lượng và tài nguyên; giao diện hiển thị trực tiếp các bước cùng đầu ra timeline.
- **Tiến trình**: xem đầy đủ từng video tải song song, phần trăm, tốc độ, ETA, trạng thái bỏ qua, đường dẫn tệp; pause/resume/cancel/retry mọi job.
- **Công cụ**: Tool Center dùng chung cho cả Tải nhiều danh sách và Tải & Ghép; health check, repair, update và rollback yt-dlp, FFmpeg, ffprobe, ffplay, aria2c.
- **Nhật ký**: lọc theo danh sách, mức log và module; xuất diagnostic bundle.
- **Cài đặt**: đường dẫn, cookies, proxy, aria2c, min/max chất lượng, số list, worker, thread, CPU priority và verification.

## Chất lượng và xác minh

- Thiết lập min/max cho resolution, FPS, video bitrate và audio bitrate.
- Chế độ CapCut trực tiếp tải tối thiểu 1080p, tối đa 1080p hoặc 2K/1440p; chuẩn hóa MP4 H.264/AAC, SDR BT.709, yuv420p 8-bit và không tạo Proxy.
- Chọn codec ưu tiên và container đầu ra.
- Tải video/audio theo selector có giới hạn do người dùng cấu hình.
- ffprobe kiểm tra thông số file thật sau tải.
- Deep verification dùng FFmpeg giải mã toàn bộ file từ đầu đến cuối.
- File hỏng hoặc không đạt giới hạn strict được chuyển vào quarantine.
- Remux MP4 bằng stream copy nếu container cho phép; nếu không, giữ file nguồn trong chế độ Auto.
- Nếu các clip tương thích, ghép bằng concat demuxer + `-c copy`.
- Nếu không tương thích, chỉ chuẩn hóa clip lệch chuẩn.
- Khi chỉ audio lệch chuẩn, video được stream-copy thay vì mã hóa lại gây giảm nét.
- Profile **Theo nguồn** chọn canvas từ nguồn thật lớn nhất; profile **Ghép thông minh** chọn nhóm định dạng chiếm tổng thời lượng lớn nhất để giảm thời gian mã hóa lại.
- Không upscale mặc định; clip nhỏ hoặc khác tỷ lệ được fit và pad để bảo toàn toàn bộ nội dung, không crop im lặng.
- Thành phẩm dùng file pending, verify, backup file cũ rồi atomic rename.

## Cookies và lỗi chặn

Cookies có thể chọn từ file Netscape hoặc Chrome/Edge/Firefox ở Settings, Preflight và ngay trên thẻ lỗi. Khi một video yêu cầu đăng nhập, chỉ list chứa video đó bị Pause; list khác tiếp tục chạy.

Lỗi tool, hết dung lượng, quyền thư mục hoặc lỗi mạng/CDN lặp lại được gom thành sự cố cấp danh sách thay vì đánh dấu hàng loạt link lỗi.

## Chạy source trên Windows

```powershell
npm.cmd ci
npm.cmd run verify:source-completeness
npm.cmd run doctor:windows
npm.cmd run check
npm.cmd run dev
```

Tạo installer ổn định chính thức:

```powershell
npm.cmd run dist:official
```

Installer được tạo tại `release\Download video Tubmedia-Setup-1.2.8-x64.exe`.

Installer nằm trong `release\`.

Tạo gói cập nhật để giải nén ghi đè trực tiếp vào source cũ:

```powershell
npm.cmd run dist:source-update
```

Xem [CHANGELOG.md](CHANGELOG.md), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md), [USER_GUIDE_VI.md](USER_GUIDE_VI.md) và [BUILD_WINDOWS.md](BUILD_WINDOWS.md).

## Cập nhật v0.9.2

- Gom trạng thái công cụ, thiết lập tải, khuyến nghị hiệu năng và mô tả chất lượng vào các thanh thông tin thu gọn.
- Nút Cookies, áp dụng theo máy và mở Trung tâm công cụ luôn hiển thị; nội dung giải thích chỉ mở khi user cần.
- Cảnh báo cấu hình có thể giảm nét và lỗi công cụ thật tự mở chi tiết; trạng thái bình thường mặc định gọn.
- Loại mô tả phụ lặp lại dưới từng mục sidebar, trong chân sidebar, tiêu đề trên và tiêu đề từng lane.
- Gộp ba khối chất lượng lặp trong mỗi quy trình ghép thành một khu duy nhất.
- Thu gọn thông tin timeline, tiến trình, dung lượng và nguyên tắc áp dụng; thao tác phụ phù hợp được chuyển thành icon.
- Tối ưu responsive để thanh thông tin và nút thao tác không chồng nhau khi cửa sổ hẹp.

## Cập nhật v0.9.1

- Tải nguồn bằng `bv+ba/b`, không còn để `bv*` chọn nhầm luồng video gộp dung lượng thấp.
- Ghi và kiểm tra format ID, độ phân giải, FPS, bitrate, dung lượng dự kiến và dung lượng thực.
- Chặn tệp sau tải nhỏ hơn 80% dung lượng format đã chọn.
- Chặn thành phẩm giữ nguồn nhỏ hơn 75% tổng video đã chuẩn bị.
- Đổi phiên bản cache của cả Tải danh sách và Tải & Ghép để file 200 MB từ bản cũ không bị dùng lại.
- Tải danh sách mặc định dùng preset đa nền tảng 720p–1080p H.264/MP4, fallback, aria2c 16 kết nối và 2 fragment; preset Nguồn cao nhất vẫn có sẵn khi cần 2K/4K/HDR.
- Logo nhà phát triển góc trái dưới lớn hơn; chữ bên trong được chia lại để dễ đọc.

## Cập nhật v0.9.0

- Tải & Ghép luôn tải video nguồn tốt nhất, ưu tiên độ phân giải, FPS, bitrate và kích thước; không còn áp chế độ CapCut hoặc giới hạn bitrate của danh sách tải lên nguồn ghép.
- Tải danh sách và Tải & Ghép có khóa nguồn, cache, tệp nhận diện và cấu hình đầu ra riêng. Cùng một link nằm ở hai chức năng không còn dùng chung bản tải.
- Trang Cài đặt có hai mục riêng **Tải danh sách** và **Tải & Ghép**; chỉ cookies, mạng và công cụ nền được dùng chung.
- Cache nguồn từ bản cũ chưa có dấu chất lượng được giữ tạm trong khu cách ly và tải lại một lần; khi nguồn mới hợp lệ, bản cũ tự được dọn để tránh chiếm thêm dung lượng.
- Cấu hình trên trang Tải & Ghép chỉ điều khiển thành phẩm cuối; mặc định mới là **Giữ nét và dung lượng gần nguồn**.
- Giao diện mở ngay từ dữ liệu local; log, nhận diện phần cứng và kiểm tra/sửa công cụ chạy tiếp ở nền.
- Installer nhận đúng thư mục đã cài và ghi đè bản cũ; app ID, product name và khóa Registry được khóa cố định để bản sau không tạo thêm mục ứng dụng.
- Gói source update đặt toàn bộ mã nguồn ngay ở gốc ZIP để giải nén trực tiếp vào thư mục source cũ và chọn ghi đè tất cả.

## Cập nhật v0.8.9

- Sửa NTSTATUS `-1073741558` (`STATUS_PROCESS_IS_TERMINATING`) khi bấm tạm dừng đúng lúc yt-dlp/FFmpeg/aria2c đang tự kết thúc.
- Bỏ qua an toàn PID vừa biến mất ở cả bước mở tiến trình và bước gọi `NtSuspendProcess`/`NtResumeProcess`.
- Nếu tiến trình cha kết thúc trong lúc các tiến trình con vừa bị tạm dừng, ứng dụng tự hoàn tác để không để lại FFmpeg/aria2c treo mồ côi.
- Tuần tự hóa và chống lặp lệnh tạm dừng/tiếp tục trên từng tiến trình, tránh tăng nhiều lần bộ đếm suspend khi user bấm nhanh.
- Giữ nguyên toàn bộ tính năng tải CapCut SDR, timeline, theo dõi dung lượng và cấu hình giữ nét của v0.8.8.

## Cập nhật v0.8.8

- Nút Copy riêng ở đầu từng mốc timeline; chỉ lấy `00:00 Ph`, không lấy `Video_001`.
- Bảng dung lượng theo toàn bộ quy trình: video nguồn, dữ liệu tạm, thành phẩm và tổng.
- Cảnh báo thành phẩm bị nén thấp bất thường so với tổng video nguồn.
- Cấu hình **Giữ nét và dung lượng gần nguồn** dành cho trường hợp tệp ghép thường 6–7 GB nhưng bị giảm còn khoảng 1–2 GB.

## Cập nhật v0.8.7

- Thêm lựa chọn tải video dựng trực tiếp trong CapCut: SDR 1080p hoặc SDR 1080p–2K/1440p, H.264/AAC/MP4/BT.709/yuv420p, tối đa 60 FPS; không tạo và không cần Proxy trong CapCut.
- Phát hiện HDR PQ/HLG/BT.2020/10-bit và chỉ tone-map rõ ràng sang SDR khi user chọn chế độ CapCut.
- Timeline mặc định chỉ nằm trên giao diện. Nút **Copy mốc 00:00 Ph** chỉ sao chép các dòng ngắn như `00:00 Ph Video_001`.
- Sau khi ghép, user nhấn biểu tượng Xuất TXT để mở Save As; ứng dụng không tự tạo TXT/CSV/JSON trong thư mục thành phẩm.
- Sửa luồng chuẩn hóa ghép để giữ nguyên video byte-for-byte khi chỉ audio khác chuẩn, tránh mã hóa lại làm giảm độ nét.
- Thêm cấu hình **1080p rõ nét theo code tham chiếu** đúng thông số hình 1920×1080, 30 FPS, libx264 CRF 18, preset veryfast, yuv420p BT.709.
- Hiển thị cảnh báo ngay cạnh cấu hình 720p/1080p nếu lựa chọn sẽ làm giảm chi tiết nguồn 2K/4K.
- Tự dọn clip, file `.part/.ytdl/.aria2`, pending, concat và thư mục normalize sau khi quy trình hoàn tất; giữ nguyên tệp bất kỳ của user.

## Cập nhật v0.8.3

- Buộc toàn bộ tiến trình yt-dlp dùng UTF-8, sửa tên video tiếng Việt bị biến thành `T�m Em...`.
- Tự dọn tên hỏng đã lưu từ phiên bản cũ; metadata thật sẽ được ghi lại khi yt-dlp đọc liên kết.
- Khi ba công cụ bắt buộc đã sẵn sàng, tự đưa riêng các tác vụ từng bị chặn do thiếu công cụ về hàng chờ; không tự chạy lại lỗi video, mạng hoặc cookies.
- Nhận diện video đã tải theo source/link và ID media, không dựa vào tiêu đề.
- Trước khi bỏ qua luôn kiểm tra tệp thật bằng ffprobe/verification; tệp hỏng được đưa vào khu cách ly và tải lại.
- Trạng thái bỏ qua hiển thị `Đã tải trước đó – đã bỏ qua`, kèm tên và đường dẫn tệp.
- Mỗi danh sách tải và quy trình ghép chỉ còn một thanh tiến trình tổng; chi tiết từng video tải song song được chuyển sang trang Tiến trình.

## Cập nhật v0.8.2

- Hàng đợi chỉ bắt đầu khôi phục sau khi quá trình dò công cụ lúc khởi động đã kết thúc.
- Cổng sẵn sàng chặn mọi tác vụ nền khi `yt-dlp`, FFmpeg hoặc ffprobe chưa chạy được, nên không còn tạo hàng loạt lỗi do trạng thái khởi động tạm thời.
- Các lần kiểm tra công cụ được chạy tuần tự để kiểm tra lúc khởi động, kiểm tra cập nhật và thao tác từ giao diện không ghi đè trạng thái của nhau.
- Trước khi tải chỉ kiểm tra lại ba công cụ bắt buộc khi trạng thái thiếu, lỗi hoặc đã quá cũ; không quét lại toàn bộ năm công cụ sau mỗi 30 giây.
- Chuẩn hóa đường dẫn công cụ do người dùng nhập, kể cả đường dẫn được bọc bằng dấu ngoặc kép.
- Nhận diện và hiển thị khả năng đã xác minh của yt-dlp, ffprobe, ffplay và aria2c; không còn câu “Chưa nhận diện được khả năng” cho công cụ đang sẵn sàng.
- Thông báo thiếu công cụ nêu đúng executable gặp lỗi và xác nhận hàng đợi vẫn được giữ nguyên.

## Cập nhật v0.8.1

- Ghi đè asset `tubmedia-app-icon.png` cũ bằng PNG hợp lệ để sửa lỗi `dữ liệu PNG bị thiếu` khi giải nén bản mới đè lên thư mục cũ.
- Timeline TXT và timeline trên giao diện dùng đúng định dạng `00:00 Ph Video_001`.
- Sau khi ghép, giao diện nhận thời gian bắt đầu/kết thúc thực tế từ backend và lưu cùng tác vụ để mở lại ứng dụng vẫn xem được.
- Ở thời điểm v0.8.1 từng có CSV/JSON; từ v0.8.7 hai tệp này đã bị loại bỏ để không tạo rác máy.

## Cập nhật v0.8.0

- Thay toàn bộ logo raster trong giao diện bằng logo vector đồng nhất; không còn phụ thuộc ảnh PNG lỗi hoặc thanh viền cắt qua nhận diện.
- Tự dò và tự sửa yt-dlp, FFmpeg, ffprobe lúc khởi động trên Windows x64; vẫn kiểm tra lại ngay trước khi tạo hàng đợi.
- Ép yt-dlp tải thật và xuất tiến trình dù đang dùng các hook lấy metadata.
- Tên tệp lấy từ tiêu đề video thật kèm ID nguồn để tránh ghi đè khi trùng tiêu đề.
- Hiển thị tiến trình riêng từng video: trạng thái, phần trăm, tốc độ, ETA và đường dẫn đầu ra.
- Tải–ghép chỉ còn một trường tên sản phẩm. Timeline nằm trên giao diện và chỉ tạo TXT khi user chủ động nhấn biểu tượng Xuất.
- Giảm tần suất ghi SQLite/phát sự kiện tiến trình để giao diện mượt hơn khi yt-dlp hoặc FFmpeg gửi nhiều dòng trạng thái.
- Thêm kiểm tra tính toàn vẹn asset và kiểm thử hồi quy cho parser tiến trình, đầu ra timeline và metadata hàng đợi.

## Cập nhật v0.6.0

- Đổi tên sản phẩm và file cài đặt thành **Download video Tubmedia**.
- Thiết kế đỏ/trắng Tubmedia mới cho toàn bộ ứng dụng, hỗ trợ màu sáng và tối theo Windows.
- Sửa vỡ/tràn giao diện bằng grid tự co giãn, breakpoint mới và giới hạn nội dung an toàn.
- Thiết kế lại Sidebar, Topbar, Trung tâm công cụ, About, card, button, form, dialog và progress.
- Chữ ký **Đình Duy / Tubmedia** được làm lại nổi bật, cân đối và sang trọng hơn.
- Giữ nguyên CPU tự động, backend tải-ghép, cookies, queue, database và cơ chế kiểm tra file của v0.5.1.

## Cập nhật v0.5.0

- Giao diện Aurora sáng, hiện đại, responsive và có animation/reduced-motion.
- Tool readiness dùng chung được hiển thị và kiểm tra trực tiếp trên cả hai workflow.
- Xóa hoàn toàn từng danh sách/pipeline khỏi ứng dụng mà vẫn giữ file video trên ổ đĩa.
- Xóa từng dòng hoặc dọn hàng loạt lịch sử tiến trình đã kết thúc.
- Hộp xác nhận chuyên nghiệp cho thao tác xóa và thông báo trạng thái rõ ràng.
- Hiển thị nhà phát triển **Đình Duy Tubmedia** ở Sidebar và trang Giới thiệu.

## Cập nhật v0.4.0

- 1–4 danh sách tải độc lập và 1–4 pipeline tải-ghép độc lập.
- Mỗi khu vực có nút điều khiển theo trạng thái, progress/log riêng và chức năng dọn lịch sử.
- Cookies hỗ trợ trình duyệt, dán trực tiếp và file TXT.
- Lỗi quan trọng hiển thị bằng cảnh báo tiếng Việt nổi bật; chi tiết kỹ thuật được thu gọn.
- Menu native đã được gỡ; giao diện có loading state, animation và phản hồi cho thao tác chính.

## Tubmedia v1 — Release Candidate

Bản v1.0.0 RC1 bổ sung Trung tâm cập nhật tại chỗ, motion/UI tối ưu, scheduler hàng đợi không chồng lặp và quy trình release NSIS có metadata cập nhật vi sai. Xem `UPDATE_RELEASE_GUIDE_VI.md` và `KIEM_THU_v1.0.0_RC1_VI.md` trước khi build installer chính thức.
