# Video Facebook không tải được vì đường dẫn tệp quá dài (2026-10-23)

## Vì sao

Facebook `1589967605531745` (Arms Family Homestead) và `1082062584736195` lỗi 6 lần từ 20/10 (bản 1.7.0, 1.7.1):
`ERROR: unable to open for writing: [Errno 2] No such file or directory: 'E:\DinhDuy\NA401_Bẫy lợn\video\610K views · … [LINK_AE98B42CCDF5].f1205344837823463v.mp4.part'`.

- Tiêu đề Facebook rất dài ("610K views · 8.6K reactions | <nội dung bài> | <tên trang>"), được cắt ở 165 byte bất kể thư mục
  lưu dài bao nhiêu (`--trim-filenames 230` chỉ tính tên tệp).
- Tệp tạm của yt-dlp nối thêm `.f<mã định dạng>.mp4.part`; mã định dạng Facebook dài 16–17 chữ số (YouTube chỉ ~3).
- Tổng đường dẫn 260–262 ký tự ≥ MAX_PATH 260; máy để `LongPathsEnabled = 0` → Python không mở được tệp.
- Lỗi bị xếp "không xác định, không thử lại" với câu chung chung.
- `-o` là đường dẫn tuyệt đối nên yt-dlp bỏ qua `--paths temp:` ("--paths is ignored since an absolute path is given in
  output template") → tệp `.part` nằm ngay trong thư mục video.

yt-dlp nhận diện link bình thường, không cần cookie; tải bằng tên ngắn thì đủ.

## Sửa

1. `src/shared/utils/download-path-budget.ts` — `planDownloadName`: chỗ cho tiêu đề = 259 − thư mục dài hơn (nguồn hoặc tạm) − 1
   − phần cố định (`[Nguon-…]`, `[mã]`, `[ban-rieng-…]`, `[LINK_…]`) − độ dài mã video − 36 ký tự đuôi tệp tạm. Thư mục ngắn
   vẫn giữ mức cắt cũ (165/145 byte). Chỗ < 12 byte → tên `Video [mã] [LINK_…]`. Không tên nào vừa → báo "Thư mục lưu video
   quá dài (N ký tự)…", không chạy yt-dlp. Mã video + mã liên kết luôn ở cuối nên tệp có sẵn vẫn được nhận ra.
2. `download-failure.ts` — loại lỗi mới `path_too_long` (kiểm trước mọi loại khác, vì đường dẫn chứa nguyên tiêu đề):
   `[Errno 2]/[Errno 22]` kèm đường dẫn > 259 ký tự, hoặc `WinError 206` / `Errno 36`. Thư mục thật sự không tồn tại (đường
   dẫn ngắn) không bị nhận nhầm. Thử lại được; câu báo: "Không lưu được video vì đường dẫn tệp quá dài (N ký tự)… Tubmedia sẽ
   tự rút ngắn tên tệp và thử lại." Hết lượt thử → khuyên chọn thư mục lưu ngắn hơn.
   `DownloadEngine` đếm số lần lỗi này cho từng tác vụ: lần thử lại thứ nhất tiêu đề ngắn một nửa, lần sau bỏ tiêu đề. Lỗi
   khác không làm đổi tên tệp (tệp `.part` vẫn được tải tiếp).
3. Mẫu `-o` thành tên tương đối + `--paths home:<thư mục nguồn>` + `--paths temp:<thư mục tạm>\_dl\<mã danh sách>`: tệp
   `.part`, mảnh HLS, tệp ghép nằm trong thư mục tạm; yt-dlp dời tệp cuối sang thư mục nguồn. Thư mục con riêng mỗi danh
   sách (nhiều danh sách dùng chung `E:\Tubmedia`). Tên `_dl` không thuộc nhóm thư mục bị dọn tự động.

Chưa làm: bước kiểm dung lượng trống trước khi tải vẫn chỉ xem ổ chứa thư mục nguồn (thư mục tạm có thể chưa tồn tại lúc
đó — kiểm sẽ tạm dừng nhầm danh sách).

## Kiểm tra

- Unit `tests/unit/download-path-budget.test.ts`: đúng ca thật (mọi tệp tạm/tệp cuối ≤ 259), thư mục ngắn giữ 165, thử lại
  một nửa → bỏ tiêu đề, thư mục quá sâu, mã video dài; phân loại lỗi ca thật 260 ký tự, thư mục không tồn tại, WinError 206 /
  Errno 36, tiêu đề chứa "403/fragment/removed"; câu báo cuối.
- Integration `tests/integration/download-path-too-long.test.ts`: tham số `--paths`/`-o` thật của DownloadEngine, thư mục
  tạm được tạo, thư mục dài như máy thật, thư mục quá dài (không chạy yt-dlp), chuỗi 3 lượt thử, lỗi khác giữ nguyên tên.
- yt-dlp giả trong `download-existing-file-reuse` và `download-pacing-args` đặt tệp theo `home:` như yt-dlp thật.
