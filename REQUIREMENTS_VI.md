# PROMPT TỔNG HỢP HOÀN CHỈNH

# XÂY DỰNG ỨNG DỤNG DESKTOP TẢI, XỬ LÝ VÀ GHÉP VIDEO ĐA PROJECT

Bạn là một **Senior Desktop Software Architect, Senior TypeScript Engineer, Senior React Engineer, UI/UX Designer và chuyên gia yt-dlp, FFmpeg, SQLite, Windows Process Management**.

Nhiệm vụ của bạn là phân tích code cũ và xây dựng lại thành một ứng dụng desktop Windows hoàn chỉnh, chuyên nghiệp, trực quan, ổn định, dễ sử dụng, dễ sửa lỗi, dễ bảo trì và dễ cập nhật trong tương lai.

Tôi sẽ cung cấp:

1. File code Deno/TypeScript cũ.
2. File cấu hình máy tính Windows.
3. Một số file TXT chứa danh sách link video.
4. Một số ví dụ link kèm timestamp và ghi chú thực tế.

Hãy đọc code cũ để hiểu đúng quy trình nghiệp vụ, nhưng **không tiếp tục nhồi thêm chức năng vào file code nguyên khối cũ**.

Hãy xây dựng một dự án mới có:

* Frontend đẹp, hiện đại, dễ nhìn và dễ hiểu.
* Backend xử lý nghiệp vụ rõ ràng.
* Kiến trúc module.
* Typed IPC.
* SQLite.
* Quản lý nhiều project.
* Smart Download.
* Smart Normalize.
* Smart Merge.
* Quản lý tool.
* Cập nhật ứng dụng.
* Backup và rollback.
* Logging.
* Crash recovery.
* Test tự động.
* Bộ cài Windows.

---

# 1. MỤC TIÊU TỔNG THỂ

Xây dựng một ứng dụng desktop Windows có tên tạm thời:

**Video Download & Merge Studio Pro**

Ứng dụng dùng để:

* Tạo và quản lý nhiều project hoặc nhiều kịch bản video.
* Dán nhiều link video vào từng project.
* Import link từ file TXT.
* Kéo thả file TXT vào ứng dụng.
* Phân tích URL, timestamp và ghi chú.
* Tải video theo đúng thứ tự.
* Tải chất lượng nguồn cao nhất có thể.
* Dùng lại video đã tải thay vì tải trùng.
* Tạo nhiều clip từ một video nguồn.
* Chuẩn hóa video chỉ khi thực sự cần.
* Ghép nhiều video thành một video thành phẩm.
* Tạo timeline TXT, CSV hoặc JSON.
* Theo dõi trạng thái tải và xử lý.
* Chọn thư mục lưu bằng giao diện.
* Thay đổi mọi cấu hình trên giao diện.
* Không yêu cầu người dùng sửa source code.
* Không yêu cầu sao chép thêm một file code cho mỗi project.
* Không làm máy bị giật nặng khi normalize.
* Giữ chất lượng video cuối cao nhất có thể.
* Có khả năng cập nhật tool và ứng dụng an toàn.
* Có khả năng backup, rollback và phục hồi khi lỗi.

Đây phải là **ứng dụng desktop thật**, không phải website.

Ứng dụng production:

* Không chạy Express.
* Không chạy Fastify.
* Không mở localhost.
* Không mở trình duyệt ngoài.
* Không dùng backend HTTP server.
* Không phụ thuộc web server.
* Không dùng Deno Desktop experimental.
* Không dùng API thử nghiệm không ổn định.

Frontend và backend nằm trong cùng một ứng dụng desktop:

```text
Frontend:
Electron Renderer + React + TypeScript

Backend:
Electron Main Process + Utility Process/Worker khi cần

Communication:
Typed IPC qua preload bridge

Database:
SQLite
```

Production phải load frontend từ asset local đã đóng gói.

---

# 2. CÔNG NGHỆ BẮT BUỘC

Sử dụng:

* Electron stable.
* TypeScript strict mode.
* React.
* electron-vite hoặc Vite với cấu hình Electron chuẩn.
* SQLite.
* Zod.
* Zustand hoặc Redux Toolkit.
* React Hook Form.
* Tailwind CSS.
* Radix UI hoặc shadcn/ui được đóng gói local.
* Lucide Icons hoặc icon library local.
* Vitest.
* Playwright cho Electron E2E.
* ESLint.
* Prettier.
* Electron Builder.
* Structured logging.
* Database migrations.
* Lockfile được commit.

Không dùng CDN cho:

* JavaScript.
* CSS.
* Icon.
* Font.
* Thư viện giao diện.

Không tự động nâng dependency major khi chưa:

1. Chạy typecheck.
2. Chạy lint.
3. Chạy unit test.
4. Chạy integration test.
5. Build production.
6. Kiểm tra migration.
7. Kiểm tra khả năng rollback.

---

# 3. KIẾN TRÚC FRONTEND VÀ BACKEND

## 3.1. Frontend

Frontend chỉ chịu trách nhiệm:

* Hiển thị giao diện.
* Nhận thao tác người dùng.
* Hiển thị trạng thái.
* Validate form cơ bản.
* Gửi yêu cầu qua typed IPC.
* Nhận event tiến trình từ backend.
* Quản lý state trình bày.

Frontend không được:

* Chạy FFmpeg trực tiếp.
* Chạy yt-dlp trực tiếp.
* Truy cập database trực tiếp.
* Truy cập filesystem trực tiếp.
* Chạy command tùy ý.
* Lưu cookies plaintext.
* Tự xử lý nghiệp vụ download.

## 3.2. Backend

Backend chịu trách nhiệm:

* Quản lý project.
* Database.
* Filesystem.
* Folder dialog.
* Queue.
* Download engine.
* Media analysis.
* FFmpeg processing.
* Merge.
* Tool Manager.
* Application Updater.
* Process Manager.
* Logging.
* Crash recovery.
* Backup.
* Restore.
* Security.
* IPC handlers.

Backend không được phụ thuộc vào React.

## 3.3. Preload

Preload chỉ expose API cần thiết bằng `contextBridge`.

Ví dụ:

```ts
interface DesktopApi {
  projects: ProjectApi;
  links: LinkApi;
  queue: QueueApi;
  media: MediaApi;
  tools: ToolApi;
  updates: UpdateApi;
  settings: SettingsApi;
  dialogs: DialogApi;
  logs: LogApi;
}
```

Không expose trực tiếp:

```ts
ipcRenderer
fs
path
child_process
shell command
database connection
```

---

# 4. BẢO MẬT ELECTRON

Cấu hình BrowserWindow:

```ts
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
```

Bắt buộc:

* Dùng preload bridge.
* Mỗi IPC request có Zod schema.
* Mỗi IPC response có type rõ ràng.
* Kiểm tra sender của IPC.
* Không cho Renderer truyền command tùy ý.
* Không cho Renderer tự chọn executable tùy ý.
* Không dùng `shell: true`.
* Chặn navigation ngoài domain local của ứng dụng.
* Chặn tạo cửa sổ không được phép.
* Không cho phép remote code execution.
* Không log cookies.
* Không log Authorization header.
* Không log token.
* Không đưa thông tin bí mật vào error report.

Mọi process phải chạy bằng:

```ts
spawn(executablePath, args, {
  shell: false
});
```

Mỗi argument là một phần tử riêng trong mảng.

---

# 5. GIAO DIỆN CHUYÊN NGHIỆP

Giao diện phải:

* Hiện đại.
* Bắt mắt nhưng không rối.
* Chuyên nghiệp.
* Dễ đọc.
* Dễ dùng.
* Dễ hiểu với người không biết code.
* Ưu tiên tiếng Việt.
* Có Dark Mode và Light Mode.
* Hoạt động tốt ở Windows scaling 100%, 125% và 150%.
* Tối ưu cho màn hình Full HD.
* Có responsive layout trong phạm vi cửa sổ desktop.
* Không phụ thuộc màu sắc để biểu thị trạng thái.
* Mỗi trạng thái phải có icon, text và màu.
* Có tooltip cho chức năng nâng cao.
* Có màn hình empty state rõ ràng.
* Có skeleton loading.
* Có error state.
* Có xác nhận cho thao tác nguy hiểm.
* Có thông báo thành công, cảnh báo và thất bại dễ hiểu.

## 5.1. Design system

Tạo design system thống nhất:

* Khoảng cách.
* Typography.
* Button.
* Input.
* Select.
* Modal.
* Dialog.
* Table.
* Card.
* Badge.
* Progress bar.
* Status chip.
* Toast.
* Tooltip.
* Sidebar.
* Tabs.
* Empty state.
* Confirmation dialog.

Không viết CSS rải rác không kiểm soát.

## 5.2. Bố cục chính

Sidebar trái:

```text
Dashboard
Projects
Downloads
Processing
Source Cache
Tools
Updates
Logs
Settings
About
```

Thanh trên cùng:

* Tên project đang mở.
* Trạng thái toàn ứng dụng.
* CPU.
* RAM.
* Disk.
* Download speed.
* Encode speed.
* Nút Pause All.
* Notification center.

## 5.3. Dashboard

Hiển thị:

* Tổng số project.
* Project đang hoạt động.
* Task đang tải.
* Task đang normalize.
* Task lỗi.
* Dung lượng đã tải.
* Dung lượng source cache.
* Dung lượng ổ đĩa còn lại.
* Tốc độ tải hiện tại.
* Tốc độ encode.
* CPU.
* RAM.
* Lỗi gần đây.
* Project gần đây.

## 5.4. Project Detail

Các tab:

```text
Tổng quan
Danh sách link
Thứ tự ghép
Tải xuống
Xử lý
Timeline
Thành phẩm
Files
Logs
Cài đặt
```

## 5.5. Wizard tạo project

Tạo project theo từng bước:

### Bước 1: Thông tin

* Tên project.
* Mã project.
* Mô tả.
* Template.

### Bước 2: Thư mục

* Source cache.
* Temp processing.
* Output.
* Final filename.

### Bước 3: Chất lượng

* Highest Source.
* Smart Highest Quality.
* 1080p Compatible.
* Smooth Background.
* Custom.

### Bước 4: Tài nguyên máy

* Interactive.
* Balanced.
* Full Power.
* Custom.

### Bước 5: Xác nhận

Hiển thị toàn bộ cấu hình trước khi tạo.

---

# 6. HỆ THỐNG QUẢN LÝ NHIỀU PROJECT

Ứng dụng phải thay thế hoàn toàn việc:

* Copy file code.
* Sửa `links.txt`.
* Sửa đường dẫn video.
* Sửa tên thành phẩm.
* Chạy nhiều cửa sổ code riêng.

Mỗi project có:

```ts
interface Project {
  id: string;
  name: string;
  code: string | null;
  description: string;
  status: ProjectStatus;
  sourceFolder: string;
  tempFolder: string;
  outputFolder: string;
  quarantineFolder: string;
  finalFileName: string;
  qualityProfileId: string;
  resourceProfileId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
```

Chức năng:

* Tạo project.
* Đổi tên.
* Nhân bản.
* Lưu thành template.
* Tạo từ template.
* Archive.
* Restore.
* Xóa.
* Tìm kiếm.
* Lọc trạng thái.
* Sắp xếp.
* Import project.
* Export project.
* Backup project.
* Restore project.
* Mở folder.
* Copy cấu hình từ project khác.

Mỗi project lưu riêng:

* Danh sách link.
* Thứ tự video.
* Ghi chú.
* Output folder.
* Source cache.
* Temp folder.
* Quality profile.
* Resource profile.
* Queue.
* History.
* Timeline.
* Logs.
* Final output.
* Project settings.

---

# 7. CHỌN FILE VÀ THƯ MỤC

Sử dụng native Electron dialog từ Main Process.

Cho phép chọn:

* File TXT.
* Source cache folder.
* Temp folder.
* Output folder.
* Backup file.
* Cookies file.

Khi chọn folder, backend phải:

1. Chuẩn hóa đường dẫn.
2. Kiểm tra tồn tại.
3. Tạo nếu chưa có và người dùng đồng ý.
4. Kiểm tra quyền ghi.
5. Ghi một file test tạm.
6. Xóa file test.
7. Kiểm tra dung lượng trống.
8. Phát hiện ổ đĩa.
9. Phát hiện SSD/HDD khi có thể.
10. Cảnh báo nếu ổ gần đầy.
11. Cảnh báo nếu temp và output cùng nằm trên HDD chậm.
12. Hiển thị thông tin trước khi xác nhận.

Có các nút:

```text
Chọn thư mục
Tạo thư mục mới
Mở thư mục
Dùng làm mặc định
Kiểm tra lại
Xác nhận
Hủy
```

Không hardcode ổ C, D hoặc E trong source code.

---

# 8. INPUT PARSER CHUYÊN NGHIỆP

Cho phép:

* Paste nhiều link.
* Import TXT.
* Drag and drop TXT.
* Drag and drop URL.
* Import clipboard.
* Append.
* Replace.
* Import từ project khác.

Parser phải xử lý các dòng:

```text
"https://youtu.be/abc?t=20
https://youtu.be/def?t=80 giữ âm gốc
https://youtu.be/xyz?t=120 bỏ âm thanh
https://youtu.be/jkl?t=1 lấy 2 giây đầu
https://drive.google.com/file/d/abc/view
```

Tách riêng:

```ts
interface ParsedInputLine {
  id: string;
  lineNumber: number;
  originalText: string;
  url: string | null;
  normalizedUrl: string | null;
  platform: string | null;
  extractorKey: string | null;
  mediaId: string | null;
  timestampStartSeconds: number | null;
  timestampEndSeconds: number | null;
  note: string;
  audioMode: "keep" | "mute" | "default";
  validity: "valid" | "warning" | "invalid";
  warnings: string[];
  errors: string[];
}
```

Parser phải xử lý:

* Ngoặc kép thừa.
* Dấu phẩy cuối dòng.
* Dấu chấm phẩy.
* Tab.
* BOM UTF-8.
* Ký tự zero-width.
* Ghi chú sau URL.
* Nhiều URL một dòng.
* Comment `#`.
* Comment `//`.
* Dòng trống.
* URL trùng.
* Timestamp.
* Playlist.
* Shorts.
* Live.
* Link rút gọn.
* Link nhiều nền tảng.

Hỗ trợ timestamp:

```text
?t=83
?t=1m23s
00:01:23
00:01:23-00:01:45
83-105
start=83 end=105
```

Không truyền phần ghi chú vào yt-dlp.

Màn hình preview phải cho phép:

* Sửa URL.
* Sửa ghi chú.
* Sửa timestamp.
* Chọn audio.
* Xóa dòng.
* Chọn nhiều dòng.
* Lọc dòng lỗi.
* Tự động sửa lỗi đơn giản.
* Xác nhận trước khi import.

---

# 9. NHẬN DIỆN VIDEO CHÍNH XÁC

Không dùng `Video_001` làm danh tính duy nhất.

Danh tính source phải dựa trên:

```text
platform + extractorKey + mediaId
```

Ví dụ:

```text
youtube:abc123
tiktok:73829292
facebook:10293847
```

Nếu chưa lấy được media ID:

* Dùng URL normalized hash tạm thời.
* Sau khi analyze xong, cập nhật identity thật.

Mỗi source lưu:

* Original URL.
* Normalized URL.
* Platform.
* Extractor key.
* Media ID.
* Title.
* Uploader.
* Duration.
* Width.
* Height.
* FPS.
* Video codec.
* Profile.
* Level.
* Pixel format.
* Bit depth.
* HDR/SDR.
* Color primaries.
* Color transfer.
* Color space.
* Audio codec.
* Sample rate.
* Channels.
* Channel layout.
* Source file.
* Processed file.
* Verification status.
* Source hash tùy chọn.

Số thứ tự chỉ dùng cho thứ tự ghép.

Việc thêm, xóa hoặc đổi thứ tự link không được làm ứng dụng nhận nhầm file cũ.

---

# 10. CHỐNG TẢI TRÙNG

Phát hiện:

* URL trùng hoàn toàn.
* URL trùng sau normalize.
* Cùng extractor và media ID.
* Cùng video nhưng khác timestamp.
* Video đã có trong project.
* Video đã có ở project khác.
* Video đã có trong source cache.

Cho phép người dùng chọn:

```text
Bỏ dòng trùng
Giữ nhiều vị trí trong timeline
Dùng lại source
Copy file
Hard link
Tạo clip mới
Tải lại
```

Một source có thể xuất hiện nhiều lần trong timeline nhưng chỉ tải một lần.

Phải dùng lock hoặc mutex theo source ID để ngăn:

* Hai worker tải cùng source.
* Hai project ghi đè cùng cache.
* Hai task normalize cùng file.
* Cleanup của task này xóa file của task khác.

---

# 11. BA CHẾ ĐỘ TẢI

## 11.1. Tải toàn bộ video

Tải source đầy đủ theo profile.

## 11.2. Tải hoặc tạo clip timestamp

Cho phép:

* Số giây trước timestamp.
* Số giây sau timestamp.
* Start.
* End.
* Giữ audio.
* Mute.
* Copy stream khi có thể.
* Accurate cut khi cần.

## 11.3. Tải source một lần, tạo nhiều clip

Nếu có:

```text
https://youtu.be/abc?t=20
https://youtu.be/abc?t=90
https://youtu.be/abc?t=200
```

Phải:

1. Nhận diện cùng source.
2. Tải source một lần.
3. Lưu source cache.
4. Tạo ba clip.
5. Verify từng clip.
6. Gắn clip vào đúng vị trí project.
7. Không tải source ba lần.

Source cache policy:

```text
Giữ vĩnh viễn
Giữ trong X ngày
Xóa khi hoàn tất project
Xóa thủ công
Giữ nếu project khác đang dùng
```

---

# 12. DOWNLOAD ENGINE

Sử dụng yt-dlp.

Hỗ trợ:

* Best video + best audio.
* Resume.
* Partial files.
* Retry.
* Cookies.
* Cookies from browser.
* Proxy tùy chọn.
* Rate limit.
* Playlist tùy chọn.
* Progress machine-readable.
* Pause.
* Resume.
* Cancel.
* Retry failed.
* Source cache.
* Archive trong database.
* Metadata analyze trước khi tải.

Không xóa:

```text
.part
.ytdl
.frag
.aria2
```

trước lần tải đầu.

Chỉ xóa khi:

* Người dùng chọn restart.
* Partial được xác định hỏng.
* Cleanup có xác nhận.
* Job ID khớp chính xác.

Không parse tiến trình dựa hoàn toàn vào câu chữ mặc định của yt-dlp.

Dùng:

```text
--newline
--progress-template
```

và marker machine-readable có unit test.

---

# 13. QUALITY ENGINE – CHẤT LƯỢNG CAO NHẤT

Không được mặc định ép mọi video về 1080p30.

## Profile A: Highest Source Quality

* Giữ độ phân giải nguồn.
* Giữ FPS.
* Giữ HDR.
* Giữ bit depth.
* Giữ audio khi tương thích.
* Không upscale.
* Không transcode nếu không cần.
* Ưu tiên stream copy.
* Không hạ 4K xuống 1080p.
* Không hạ 60 fps xuống 30 fps.

## Profile B: Smart Merge Highest Quality

* Phân tích toàn bộ source.
* Tìm chuẩn chung phù hợp.
* Stream copy khi tương thích.
* Chỉ normalize file lệch chuẩn.
* Không encode lại toàn bộ danh sách.
* Không upscale mặc định.
* Giữ FPS cao nhất phù hợp.
* Giữ chất lượng cao nhất có thể.

## Profile C: 1080p High Quality Compatible

* Tối đa 1920×1080.
* Không upscale mặc định.
* H.264.
* AAC 48 kHz.
* MP4 faststart.
* 30 hoặc 60 fps.
* Dành cho phần mềm dựng phổ biến.

## Profile D: Smooth Background Encode

* Một encode job.
* Giới hạn thread.
* Hạ process priority.
* Có thể dùng NVENC.
* Ưu tiên giữ Windows mượt.

## Profile E: Maximum CPU Quality

* libx264.
* CRF 16–18.
* Preset medium hoặc slow.
* Một encode job.
* Giới hạn thread.
* Below Normal priority.

## Profile F: Custom

Cho người dùng cấu hình:

* Resolution.
* Max resolution.
* Upscale.
* FPS.
* Video codec.
* Encoder.
* CRF/CQ.
* Preset.
* Pixel format.
* HDR.
* Audio codec.
* Sample rate.
* Bitrate.
* Channels.
* Process priority.
* Threads.

Không tuyên bố upscale làm tăng chi tiết thật.

---

# 14. SMART NORMALIZE

Dùng ffprobe phân tích source:

```ts
interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  videoProfile: string | null;
  videoLevel: string | null;
  pixelFormat: string;
  bitDepth: number | null;
  timeBase: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorSpace: string | null;
  hdr: boolean;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
}
```

Sau đó Quality Decision Engine chọn:

```text
COPY
REMUX
VIDEO_TRANSCODE_ONLY
AUDIO_TRANSCODE_ONLY
FULL_TRANSCODE
HDR_TONEMAP
ADD_SILENT_AUDIO
```

Nếu source đã phù hợp thì không encode lại.

Hiển thị lý do:

```text
Không cần xử lý
Chỉ cần remux
Codec video không tương thích
Resolution không phù hợp
FPS không phù hợp
Audio không phù hợp
Thiếu audio
HDR cần tone-map
Pixel format không phù hợp
```

Decision engine phải độc lập với UI và có unit test.

---

# 15. KHẮC PHỤC LAG KHI NORMALIZE

Máy mục tiêu:

```text
2 × Xeon E5-2696 v3
72 logical processors
128 GB RAM
GTX 1060 3 GB
SSD 256 GB
HDD 1 TB
Windows 11 Pro
```

Không để FFmpeg chiếm toàn bộ 72 logical processors mặc định.

## Interactive – mặc định

```text
Normalize workers: 1
FFmpeg video threads: 8
Filter threads: 4
Filter complex threads: 4
Process priority: Below Normal
Download workers: 2
Remux workers: 1
```

## Balanced

```text
Normalize workers: 1
FFmpeg video threads: 12
Filter threads: 6
Filter complex threads: 6
Process priority: Below Normal
Download workers: 2–3
```

## Full Power

```text
Normalize workers: 1
Tối đa 2 khi người dùng chủ động bật
Threads tùy chỉnh
Process priority: Normal
```

Dùng khi phù hợp:

```text
-threads N
-filter_threads N
-filter_complex_threads N
```

Yêu cầu:

* Chỉ một libx264 encode mặc định.
* Đặt Below Normal priority cho FFmpeg.
* Theo dõi CPU.
* Theo dõi RAM.
* Theo dõi disk.
* Theo dõi encode FPS.
* Hiển thị ETA.
* Cảnh báo khi CPU cao kéo dài.
* Không tự đổi thread giữa job đang chạy.
* Áp dụng thay đổi cho job tiếp theo.
* Không để frontend bị block.
* Không chạy analyze nặng trên renderer thread.

Cho phép đặt temp/source cache trên SSD và output final trên HDD.

---

# 16. GPU ENCODING

Kiểm tra capability thật của FFmpeg:

```text
h264_nvenc
hevc_nvenc
```

Không chỉ dựa vào tên GPU.

Tool Manager phải kiểm tra:

* Encoder tồn tại.
* Driver hỗ trợ.
* Encode test nhỏ thành công.
* Decode/encode không crash.

Nếu khả dụng, cung cấp:

```text
NVIDIA H.264 High Quality
NVIDIA H.264 Balanced
NVIDIA H.264 Fast Background
```

GPU encoding:

* Giảm tải CPU.
* Giữ Windows phản hồi tốt.
* Có fallback libx264.
* Không crash khi NVENC lỗi.
* Hiển thị rõ khác biệt chất lượng và kích thước.

Không bắt buộc NVENC cho profile archival hoặc maximum CPU quality.

---

# 17. HDR VÀ AUDIO

## HDR

Phát hiện:

* SMPTE ST 2084.
* HLG.
* BT.2020.
* 10-bit.

Cho phép:

```text
Giữ HDR
Chuyển HDR sang SDR
Tự động
Không cho HDR
```

Không tone-map âm thầm.

Nếu tone-map CPU:

* Giới hạn filter threads.
* Chỉ một job.
* Hiển thị cảnh báo đây là tác vụ nặng.

## Audio

Không mặc định ép mọi audio về 44.1 kHz stereo.

Lựa chọn:

```text
Giữ nguyên nếu tương thích
AAC 48 kHz 256 kbps
AAC 48 kHz 320 kbps
Giữ số kênh
Ép stereo
Mute
Thêm silent track
```

Nếu audio đã tương thích thì stream copy.

---

# 18. SMART CONCAT VÀ FINAL OUTPUT

Trước khi ghép, so sánh:

* Codec.
* Profile.
* Level.
* Width.
* Height.
* FPS.
* Time base.
* Pixel format.
* Audio codec.
* Sample rate.
* Channels.
* Channel layout.

Nếu tương thích:

```text
concat demuxer + stream copy
```

Nếu không tương thích:

1. Chỉ normalize file lệch chuẩn.
2. Verify lại.
3. Sau đó concat copy.

Không encode lại final nếu không cần.

Nếu concat copy thất bại:

* Không xóa input.
* Không xóa final cũ.
* Ghi log.
* Hiển thị nguyên nhân.
* Đề xuất fallback.
* Chỉ fallback transcode sau khi người dùng xác nhận.

## Atomic output

Không xóa final cũ trước.

Quy trình:

1. Tạo `final.pending.mp4`.
2. Merge.
3. Verify.
4. So duration với tổng dự kiến.
5. Kiểm tra codec, resolution, FPS và audio.
6. Đóng file.
7. Atomic rename.
8. Backup final cũ theo chính sách.
9. Chỉ sau đó mới cleanup.

---

# 19. FILE VERIFICATION VÀ QUARANTINE

Ba mức:

## Fast

* File tồn tại.
* Size hợp lệ.
* Có video.
* Duration hợp lệ.

## Standard

* Audio đúng yêu cầu.
* Codec đúng.
* Resolution đúng.
* FPS đúng.
* Pixel format đúng.
* Duration đúng sai số.
* Packet đầu, giữa và cuối.

## Deep

```text
ffmpeg -v error -i INPUT -f null -
```

Không xóa file lỗi ngay.

Di chuyển vào:

```text
project/_quarantine
```

Lưu:

* File gốc.
* Lý do.
* Thời gian.
* Job ID.
* Tool version.
* Log liên quan.

Người dùng có thể:

* Mở file.
* Retry.
* Restore.
* Xóa.
* Bỏ qua.

---

# 20. QUEUE MANAGER

Queue phải độc lập với UI.

```ts
type JobStatus =
  | "pending"
  | "analyzing"
  | "ready"
  | "downloading"
  | "downloaded"
  | "verifying"
  | "normalizing"
  | "processing"
  | "merging"
  | "paused"
  | "retrying"
  | "completed"
  | "skipped"
  | "cancelled"
  | "failed"
  | "interrupted";
```

Hỗ trợ:

* Queue toàn ứng dụng.
* Queue theo project.
* Priority.
* Pause task.
* Pause project.
* Pause all.
* Resume.
* Cancel.
* Retry.
* Retry all failed.
* Drag reorder.
* Worker limits.
* Resource locks.
* Persist queue.
* Crash recovery.
* Resume sau khi mở lại.

Không dùng biến global `taskIndex++` làm queue chính.

Phải tránh race condition.

---

# 21. PROCESS MANAGER

Quản lý tập trung:

* yt-dlp.
* FFmpeg.
* ffprobe.
* aria2c.
* Updater helper.

```ts
interface ManagedProcess {
  id: string;
  projectId: string | null;
  jobId: string;
  tool: ToolName;
  pid: number;
  startedAt: string;
  priority: ProcessPriority;
  state: "starting" | "running" | "paused" | "stopping";
}
```

Bắt buộc:

* AbortController.
* Timeout.
* Cancel.
* Kill process tree trên Windows.
* Graceful shutdown.
* Không process mồ côi.
* Không FFmpeg chạy tiếp sau app đóng.
* Không giữ log vô hạn trong RAM.
* Ring buffer cho log gần nhất.
* Log đầy đủ ra file.

Khi đóng app:

```text
Tiếp tục chạy nền nếu hỗ trợ
Pause và đóng
Hủy job và đóng
Quay lại
```

Nếu crash:

* Job chuyển thành `interrupted`.
* Lần mở sau đề xuất Resume hoặc Restart.

---

# 22. TOOL MANAGER

Quản lý:

* yt-dlp.
* FFmpeg.
* ffprobe.
* aria2c.

```ts
interface ToolStatus {
  name: ToolName;
  available: boolean;
  executablePath: string | null;
  version: string | null;
  source: "bundled" | "managed" | "local" | "path" | null;
  capabilities: string[];
  health: "healthy" | "warning" | "broken";
  error: string | null;
  lastCheckedAt: string | null;
}
```

Không dùng logic:

```ts
success || stdout.length > 0 || stderr.length > 0
```

Tool chỉ hợp lệ khi:

1. Spawn thành công.
2. Exit code bằng 0.
3. Version parse được.
4. Capability test cần thiết thành công.

Version command:

```text
yt-dlp: --version
ffmpeg: -version
ffprobe: -version
aria2c: -v
```

Capability test:

* libx264.
* h264_nvenc.
* hevc_nvenc.
* zscale.
* tonemap.
* concat.
* AAC encoder.
* MP4 muxer.

Trang Tools hiển thị:

* Tên.
* Version.
* Status.
* Path.
* Source.
* Capability.
* Changelog.
* Test.
* Update.
* Rollback.
* Repair.
* Open folder.

Nếu aria2c không tồn tại thì không được gọi aria2c.

Nếu FFmpeg thiếu capability thì vô hiệu hóa đúng chức năng, không làm cả ứng dụng crash.

---

# 23. HỆ THỐNG UPDATE TOOL

Tạo Tool Update Service riêng.

Không update mù quáng.

Mỗi tool update theo quy trình:

1. Kiểm tra tool có đang được dùng không.
2. Kiểm tra phiên bản mới.
3. Tải metadata.
4. Hiển thị changelog.
5. Tải package vào thư mục staging.
6. Kiểm tra HTTPS.
7. Kiểm tra checksum.
8. Kiểm tra chữ ký khi có.
9. Giải nén an toàn.
10. Kiểm tra path traversal.
11. Chạy version test.
12. Chạy capability test.
13. Backup version hiện tại.
14. Thay thế atomically.
15. Chạy health check.
16. Nếu lỗi thì rollback.
17. Ghi lịch sử update.

Tách riêng:

```text
yt-dlp updater
FFmpeg/ffprobe updater
aria2c updater
```

Yêu cầu:

* Stable channel.
* Optional beta channel.
* Manual update.
* Optional automatic check.
* Không tự động cài major update khi chưa tương thích.
* Không update khi tool đang chạy.
* Giữ tối thiểu một version rollback.
* Cho phép pin version.
* Cho phép bỏ qua version.
* Cho phép repair tool.
* Không xóa bản cũ trước khi bản mới vượt qua health check.

---

# 24. APPLICATION UPDATER

Tách riêng update ứng dụng với update tool.

```ts
interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  channel: "stable" | "beta";
  releaseNotes: string;
  mandatory: boolean;
  publishedAt: string;
  packageSize: number;
}
```

Application update phải:

1. Kiểm tra update thủ công hoặc theo lịch.
2. Không block startup.
3. Hiển thị version hiện tại và version mới.
4. Hiển thị changelog.
5. Tải nền có progress.
6. Cho phép pause/cancel download.
7. Kiểm tra checksum.
8. Kiểm tra signature khi có.
9. Chỉ cài khi người dùng xác nhận.
10. Không cài khi đang download hoặc encode, trừ khi đã pause an toàn.
11. Lưu queue trước khi restart.
12. Backup database trước migration quan trọng.
13. Cài đặt khi restart.
14. Chạy migration có version.
15. Health check sau update.
16. Có rollback strategy.
17. Không làm mất project, setting hoặc history.

Tách:

```text
App binary update
Database migration
Config migration
Tool migration
```

Không gộp tất cả vào một bước không thể rollback.

---

# 25. DỄ BẢO TRÌ VÀ UPDATE CODE

Áp dụng:

* Semantic Versioning.
* Conventional Commits.
* CHANGELOG.
* Architecture Decision Records.
* Feature flags.
* Database migrations.
* Config migrations.
* Typed contracts.
* Dependency boundaries.
* Repository layer.
* Service layer.
* Domain layer.
* Adapter layer.
* Unit test.
* Integration test.
* E2E test.
* CI workflow.
* Release checklist.

Không tạo một file hàng nghìn dòng.

Mục tiêu:

* Phần lớn file dưới 300 dòng.
* Trường hợp đặc biệt không quá khoảng 400 dòng nếu có lý do.
* Component React không chứa business logic.
* IPC handler không chứa toàn bộ nghiệp vụ.
* Database query nằm trong repository.
* Tool logic nằm trong adapter.
* Quality decision nằm trong domain service.
* Không sử dụng global mutable state không kiểm soát.
* Không dùng `any` trừ trường hợp bắt buộc và phải ghi chú.
* Không dùng `catch {}` rỗng.
* Không nuốt lỗi filesystem.
* Không copy-paste module giống nhau.
* Không hardcode đường dẫn.
* Không hardcode tool version trong nhiều file.
* Không hardcode app name ở nhiều nơi.

Tạo interface để thay đổi implementation mà không sửa UI:

```ts
interface DownloadEngine {}
interface MediaAnalyzer {}
interface ProcessingEngine {}
interface MergeEngine {}
interface ToolProvider {}
interface UpdateProvider {}
interface ProjectRepository {}
interface QueueRepository {}
```

---

# 26. DATABASE SQLITE

Dùng migration versioned.

Các bảng đề xuất:

```text
projects
project_settings
project_items
input_batches
input_lines
media_sources
source_files
download_jobs
download_attempts
process_jobs
normalize_jobs
clip_jobs
merge_jobs
output_files
tool_installations
tool_update_history
app_update_history
app_settings
event_logs
schema_migrations
```

Yêu cầu:

* Foreign keys.
* Index.
* Transactions.
* WAL mode khi phù hợp.
* Backup.
* Restore.
* Migration.
* Rollback migration khi khả thi.
* Không block Renderer.
* Repository layer.
* Không SQL trong component React.
* Không lưu cookies plaintext.
* Có health check.
* Có repair/rebuild index khi cần.
* Có backup trước update lớn.

---

# 27. COOKIES VÀ XÁC THỰC

Hỗ trợ:

* Netscape cookies file.
* Cookies from Chrome.
* Cookies from Edge.
* Cookies from Firefox.
* Browser profile selection.

Kiểm tra:

* File tồn tại.
* Format cơ bản.
* Số cookie.
* Domain.
* Expiration khi có thể.

Bảo mật:

* Không log cookie value.
* Không hiển thị cookie value.
* Không gửi cookie ra ngoài.
* Không backup cookie plaintext.
* Có thể dùng Windows Credential Manager hoặc DPAPI.
* Cho phép xóa credential.
* Cảnh báo người dùng không chia sẻ cookie.

Chỉ tải nội dung người dùng sở hữu hoặc có quyền tải.

---

# 28. RETRY VÀ ERROR HANDLING

Không retry tự động:

* URL sai.
* Video private.
* Video deleted.
* Thiếu quyền.
* Geo-block không xử lý được.
* Disk full.
* Permission denied.
* Tool missing.
* Config invalid.

Có thể retry:

* Timeout.
* Connection reset.
* HTTP 429.
* HTTP 403 tạm thời.
* Fragment lỗi.
* CDN lỗi.
* Temporary file lock.

Dùng:

* Exponential backoff.
* Jitter.
* Max attempts.
* Max total duration.
* Retry without aria2.
* Retry with cookies khi phù hợp.
* Không xóa partial hợp lệ.
* Circuit breaker khi một nền tảng lỗi hàng loạt.

Tạo error class:

```text
ToolNotFoundError
ToolHealthCheckError
InvalidInputError
AuthenticationRequiredError
DiskFullError
PermissionDeniedError
NetworkError
DownloadFailedError
VerificationFailedError
ProcessingFailedError
MergeFailedError
UpdateFailedError
RollbackFailedError
DatabaseMigrationError
ProcessCancelledError
```

Frontend hiển thị thông báo dễ hiểu và cho phép xem log kỹ thuật.

---

# 29. LOGGING VÀ CHẨN ĐOÁN

Structured log:

```ts
interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  module: string;
  projectId?: string;
  jobId?: string;
  attemptId?: string;
  eventCode: string;
  message: string;
  metadata?: Record<string, unknown>;
}
```

File:

```text
logs/app.log
logs/download.log
logs/ffmpeg.log
logs/tools.log
logs/update.log
logs/error.log
```

Có:

* Log rotation.
* Max size.
* Max retention days.
* Export diagnostic bundle.
* Redact dữ liệu nhạy cảm.
* Copy technical error.
* Open log folder.
* Filter theo project/job/module.
* Không giữ toàn bộ stderr trong RAM.

Diagnostic bundle phải bỏ:

* Cookies.
* Token.
* Authorization header.
* Password.
* URL chứa credential.
* Dữ liệu riêng tư không cần thiết.

---

# 30. BACKUP VÀ RESTORE

Cho phép backup:

* Database.
* Project metadata.
* Settings.
* Timeline.
* Tool version metadata.
* Update history.

Không bắt buộc backup source video lớn trong backup mặc định.

Có lựa chọn:

```text
Backup cấu hình
Backup project metadata
Backup database đầy đủ
Backup kèm file media
```

Restore phải:

* Preview nội dung.
* Kiểm tra version.
* Chạy migration.
* Phát hiện conflict.
* Cho phép merge hoặc replace.
* Backup dữ liệu hiện tại trước replace.

---

# 31. CẤU TRÚC SOURCE CODE

```text
src/
├── main/
│   ├── app/
│   ├── windows/
│   ├── ipc/
│   ├── projects/
│   ├── database/
│   ├── queue/
│   ├── processes/
│   ├── downloader/
│   ├── media/
│   ├── quality/
│   ├── normalize/
│   ├── clips/
│   ├── merge/
│   ├── tools/
│   ├── updates/
│   ├── storage/
│   ├── backups/
│   ├── logging/
│   └── security/
├── preload/
│   ├── index.ts
│   └── api-types.ts
├── renderer/
│   ├── app/
│   ├── layouts/
│   ├── pages/
│   ├── components/
│   ├── features/
│   ├── stores/
│   ├── hooks/
│   ├── forms/
│   ├── theme/
│   └── styles/
├── shared/
│   ├── contracts/
│   ├── schemas/
│   ├── types/
│   ├── constants/
│   ├── errors/
│   └── utils/
└── tests/
    ├── unit/
    ├── integration/
    ├── fixtures/
    └── e2e/
```

---

# 32. TEST BẮT BUỘC

## Unit test

* Input parser.
* URL normalize.
* Timestamp parser.
* Duplicate detection.
* Media identity.
* Filename sanitizer.
* Quality decision.
* Smart Normalize.
* Concat compatibility.
* Timeline calculation.
* Retry classification.
* Tool version parsing.
* Update decision.
* Migration validation.

## Integration test

* Tool missing.
* Tool invalid exit code.
* Tool capability.
* Download sample.
* Resume.
* Cancel.
* Retry.
* Remux.
* CPU encode.
* NVENC nếu có.
* HDR handling.
* Audio handling.
* Smart concat.
* Atomic output.
* Quarantine.
* Database backup.
* Migration.
* Tool update rollback.
* Application update staging.
* Disk full simulation.
* Permission denied.
* Crash recovery.

## E2E

* Mở ứng dụng.
* Tạo project.
* Chọn folder.
* Import TXT.
* Paste link.
* Preview parser.
* Sắp xếp video.
* Xác nhận.
* Bắt đầu.
* Pause.
* Resume.
* Retry.
* Tạo timeline.
* Tạo final.
* Update tool.
* Backup project.
* Restore project.

---

# 33. WINDOWS INSTALLER

Tạo installer Windows x64.

Yêu cầu:

* `.exe` installer.
* Start Menu shortcut.
* Desktop shortcut tùy chọn.
* Uninstall.
* Không xóa database khi uninstall nếu chưa xác nhận.
* Dữ liệu nằm đúng AppData.
* Tool managed nằm ở thư mục riêng.
* Log nằm ở thư mục riêng.
* Database nằm ở thư mục riêng.
* Installer có version.
* Có upgrade path.
* Có repair option khi phù hợp.

Scripts:

```text
npm run dev
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:e2e
npm run build
npm run dist
```

Có thêm PowerShell hoặc BAT hỗ trợ build.

---

# 34. TÀI LIỆU

Tạo:

```text
README.md
ARCHITECTURE.md
DEVELOPMENT.md
BUILD_WINDOWS.md
USER_GUIDE_VI.md
TROUBLESHOOTING_VI.md
QUALITY_PROFILES.md
FFMPEG_PIPELINE.md
TOOL_UPDATE.md
APPLICATION_UPDATE.md
DATABASE_MIGRATIONS.md
BACKUP_RESTORE.md
SECURITY.md
RELEASE_CHECKLIST.md
CHANGELOG.md
```

Tài liệu tiếng Việt phải hướng dẫn:

* Cài đặt.
* Tạo project.
* Chọn folder.
* Dán link.
* Import TXT.
* Sắp xếp.
* Chọn chất lượng.
* Giữ máy mượt.
* GPU encode.
* HDR.
* Audio.
* Pause/resume.
* Xử lý lỗi.
* Update tool.
* Update ứng dụng.
* Rollback.
* Backup.
* Restore.

---

# 35. CÁC LỖI CODE CŨ BẮT BUỘC KHẮC PHỤC

Tạo checklist, không bỏ sót:

1. Tool detection coi stderr là thành công.
2. Dùng sai version argument của yt-dlp.
3. File chỉ được nhận diện theo index.
4. Đổi thứ tự link có thể dùng nhầm file.
5. Không có source identity đúng.
6. Không phát hiện duplicate.
7. Parser không tách ghi chú.
8. Xóa partial trước khi tải.
9. Resume không hoạt động đúng.
10. Lưu stderr vô hạn trong RAM.
11. Nuốt lỗi filesystem.
12. Xóa file lỗi ngay.
13. Không quarantine.
14. Ép mọi video 1080p30.
15. Giảm chất lượng 4K/60fps.
16. Upscale không cần thiết.
17. Tự tone-map HDR.
18. Filter HDR quá nặng.
19. libx264 không giới hạn thread.
20. Không hạ process priority.
21. Không có profile giữ máy mượt.
22. Không phát hiện NVENC.
23. Ép audio 44.1 kHz stereo.
24. Encode lại video đã tương thích.
25. Xóa source quá sớm.
26. Không kiểm tra concat compatibility.
27. Xóa final cũ trước khi final mới thành công.
28. Verification chưa đủ.
29. Không graceful shutdown.
30. Không crash recovery.
31. Không database.
32. Không multi-project.
33. Không native folder picker.
34. Không confirmation screen.
35. Không Queue Manager.
36. Không Process Manager.
37. Không Tool Manager chuyên nghiệp.
38. Không tool update an toàn.
39. Không app updater.
40. Không rollback.
41. Không backup.
42. Không installer.
43. Không test.
44. Một file source quá lớn.
45. Frontend và backend chưa tách trách nhiệm.

---

# 36. PHƯƠNG PHÁP TRIỂN KHAI

Không viết toàn bộ dự án hỗn loạn trong một lần.

Trước khi code, hãy cung cấp:

1. Tóm tắt yêu cầu.
2. Phân tích code cũ.
3. Danh sách lỗi.
4. Các giả định.
5. Sơ đồ kiến trúc.
6. Module boundaries.
7. Cấu trúc folder.
8. Database schema.
9. IPC contracts.
10. Queue design.
11. Process design.
12. Tool update design.
13. Application update design.
14. Quality decision matrix.
15. FFmpeg strategy.
16. Resource profile.
17. UI sitemap.
18. Design system.
19. Test plan.
20. Rủi ro.
21. Acceptance criteria.

Sau đó triển khai theo phase.

## Phase 1 – Foundation

* Project skeleton.
* Electron security.
* React.
* Design system.
* Layout.
* Typed IPC.
* SQLite.
* Migration.
* Logging.

## Phase 2 – Project và Input

* Project Manager.
* Folder picker.
* Settings.
* Input parser.
* Duplicate detection.
* Order editor.
* Confirmation wizard.

## Phase 3 – Download

* Tool Manager.
* Process Manager.
* yt-dlp.
* Queue Manager.
* Resume.
* Retry.
* Pause.
* Cancel.
* Cookies.

## Phase 4 – Processing

* Media analyzer.
* Quality Engine.
* Smart Normalize.
* Resource profiles.
* NVENC.
* HDR.
* Audio.
* Timestamp clips.

## Phase 5 – Merge và Output

* Smart Concat.
* Timeline.
* Verification.
* Quarantine.
* Atomic final.
* Source cache.

## Phase 6 – Update và Recovery

* Crash recovery.
* Tool updater.
* Application updater.
* Database migration.
* Backup.
* Restore.
* Rollback.

## Phase 7 – Release

* Unit test.
* Integration test.
* E2E.
* Performance review.
* Security review.
* Installer.
* Documentation.
* Release checklist.

Sau mỗi phase bắt buộc chạy:

```text
typecheck
lint
unit test
integration test liên quan
production build
```

Không chuyển phase khi còn lỗi.

---

# 37. CÁCH AI PHẢI TRẢ KẾT QUẢ

Không chỉ viết pseudocode.

Mỗi file phải có:

* Đường dẫn đầy đủ.
* Nội dung đầy đủ.
* Không dùng `...` để bỏ phần quan trọng.
* Không ghi `implement later` cho chức năng cốt lõi.
* Không tạo mock rồi tuyên bố hoàn thành.
* Không bỏ qua error handling.
* Không bỏ qua migration.
* Không bỏ qua test.

Khi sửa file:

1. Nêu file nào được sửa.
2. Nêu lý do.
3. Nêu ảnh hưởng.
4. Cập nhật test.
5. Không tạo file trùng chức năng.
6. Không copy toàn bộ module để sửa một lỗi nhỏ.

Sau mỗi phase, báo:

* Đã hoàn thành gì.
* File đã tạo.
* Test đã chạy.
* Lỗi còn lại.
* Rủi ro.
* Bước tiếp theo.

Không tuyên bố hoàn thành khi chưa chạy test và build.

---

# 38. TIÊU CHÍ NGHIỆM THU CUỐI CÙNG

Ứng dụng chỉ được xem là hoàn thành khi:

1. Chạy dưới dạng cửa sổ Windows.
2. Không mở trình duyệt.
3. Không chạy web server production.
4. Có frontend chuyên nghiệp.
5. Có backend xử lý logic tách biệt.
6. Có typed IPC.
7. Tạo nhiều project.
8. Mỗi project có folder riêng.
9. Chọn folder bằng native dialog.
10. Paste và import link.
11. Parser tách URL, timestamp và ghi chú.
12. Phát hiện duplicate.
13. Source identity chính xác.
14. Cùng source chỉ tải một lần.
15. Tạo nhiều clip từ một source.
16. Tải chất lượng nguồn cao nhất.
17. Không tự hạ 4K/60fps.
18. Smart Normalize hoạt động.
19. File phù hợp không bị encode lại.
20. Smart Concat hoạt động.
21. Không encode final nếu không cần.
22. Có profile giữ máy mượt.
23. FFmpeg không chiếm toàn bộ 72 logical processors mặc định.
24. Chỉ một normalize worker mặc định.
25. Có thread limit.
26. Có process priority.
27. Có NVENC detection.
28. Có HDR và audio options.
29. Có queue.
30. Có pause/resume/cancel/retry.
31. Resume partial hoạt động.
32. Có crash recovery.
33. Có atomic final.
34. Có quarantine.
35. Có SQLite.
36. Có migration.
37. Có logging.
38. Có Tool Manager.
39. Có update yt-dlp.
40. Có update FFmpeg/ffprobe.
41. Có update aria2c.
42. Tool update có checksum, backup và rollback.
43. Có Application Updater.
44. App update không làm mất project.
45. Có backup và restore.
46. Có rollback.
47. Có installer.
48. Có tài liệu tiếng Việt.
49. Typecheck thành công.
50. Lint thành công.
51. Unit test thành công.
52. Integration test thành công.
53. E2E cốt lõi thành công.
54. Không còn file source nguyên khối hàng nghìn dòng.
55. Cấu hình thay đổi được trên giao diện.
56. Người dùng không cần sửa code.
57. Người dùng không cần copy code cho project mới.
58. Giao diện dễ nhìn, dễ dùng và dễ hiểu.
59. Backend ổn định, có log và khả năng phục hồi.
60. Code dễ bảo trì, sửa lỗi và cập nhật lâu dài.

Hãy bắt đầu bằng việc đọc các file tôi cung cấp, phân tích pipeline cũ, lập tài liệu kiến trúc và kế hoạch triển khai trước khi viết code.
