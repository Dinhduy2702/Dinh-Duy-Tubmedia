# Hướng dẫn sử dụng Tubmedia 0.8.3

## Chuẩn bị công cụ

Ứng dụng tự kiểm tra khi mở. Ba công cụ bắt buộc:

- yt-dlp
- FFmpeg
- ffprobe

ffplay và aria2c là tùy chọn. Ứng dụng tự nhận file trong thư mục `tool` cạnh source/app. Nút Kiểm tra lại, Khôi phục và Cập nhật được dùng khi cần kiểm tra thủ công.

## Chọn số danh sách và áp dụng cấu hình máy

1. Mở **Tải nhiều danh sách**.
2. Dùng **Thêm danh sách/Bớt danh sách** để chọn 1–4 danh sách.
3. Bấm **Áp dụng theo số danh sách hiện tại**.
4. Kiểm tra giới hạn worker tổng và worker của từng danh sách.

Khi bật Deep verification, ứng dụng tự đề xuất ít worker hơn vì FFmpeg phải đọc và giải mã toàn bộ file.

## Thiết lập chất lượng tải

Mở **Cài đặt > Tải xuống** để đặt:

- **Chế độ tương thích video**:
  - **Theo nguồn**: dùng các giới hạn thủ công bên dưới.
  - **CapCut trực tiếp SDR 1080p**: chỉ nhận nguồn tối thiểu 1080p, xuất MP4 H.264/AAC/BT.709.
  - **CapCut trực tiếp SDR 1080p–2K**: ưu tiên 1440p, không nhận thấp hơn 1080p.
- Độ phân giải min/max.
- FPS min/max.
- Video bitrate min/max.
- Audio bitrate min/max.
- Codec ưu tiên và container.
- Cho phép fallback hoặc strict mức tối thiểu.
- Kiểm tra toàn bộ video bằng FFmpeg.

Giá trị `0` nghĩa là không giới hạn. Backend vẫn phân tích file thật bằng ffprobe sau tải.

Chế độ CapCut tự chuyển HDR/10-bit sang SDR BT.709 khi cần. Video đưa thẳng vào CapCut, không tạo và không cần bật Proxy. Trường **Proxy mạng khi tải** chỉ dành cho kết nối Internet và không liên quan Proxy của CapCut.

## Tải nhiều danh sách

Với mỗi list:

1. Dán link hoặc chọn TXT.
2. Chọn thư mục lưu và temp riêng.
3. Chọn Resource Profile và số video tải đồng thời.
4. Bấm **Bắt đầu tải**.
5. Theo dõi một thanh tiến trình tổng và khung log riêng của danh sách.
6. Mở **Tiến trình** để xem từng video tải song song, phần trăm, tốc độ, ETA và đường dẫn tệp.

Mỗi dòng có thể chứa URL kèm ghi chú; ghi chú không được truyền vào yt-dlp. Các list khác tiếp tục chạy khi một list Pause hoặc gặp lỗi chặn.

Nếu video đã tải trước đó, Tubmedia nhận diện theo link/source và ID media, kiểm tra tệp bằng ffprobe rồi hiển thị **Đã tải trước đó – đã bỏ qua**. Hai video trùng tên nhưng khác ID/link vẫn là hai video riêng. Tệp cũ bị hỏng hoặc tải dở không bị bỏ qua mà được đưa vào khu cách ly để tải lại.

## Cookies

Cookies có thể thêm tại Settings, Preflight hoặc thẻ lỗi của list:

- Chọn file `cookies.txt` Netscape.
- Dùng Chrome, Edge hoặc Firefox.

Khi video yêu cầu đăng nhập, chỉ list đó Pause. Chọn cookies và tiếp tục; queue của list khác không bị ảnh hưởng.

## Tải và ghép

1. Mở **Tải & Ghép**.
2. Dán link theo đúng thứ tự muốn ghép.
3. Chọn Source, Temp và Output.
4. Nhập tên thành phẩm.
5. Chọn:
   - **Ghép thông minh chất lượng cao nhất** nếu muốn giữ nét nguồn 2K/4K.
   - **1080p rõ nét theo code tham chiếu** nếu muốn đúng 1920×1080/30 FPS/libx264 CRF 18 như `DownloadAndConcat(2).ts`.
6. Chọn Resource Profile phù hợp.
7. Khi cần TXT, nhấn biểu tượng **Xuất timeline** sau khi ghép rồi tự chọn tên và nơi lưu; mặc định timeline chỉ nằm trên giao diện.
8. Bấm **Bắt đầu tải và ghép**.

Timestamp hỗ trợ `?t=83`, `1m23s`, `00:01:23-00:01:45` hoặc `start=83 end=105`. Cùng một source xuất hiện nhiều lần chỉ tải một lần nhưng vẫn tạo đủ vị trí timeline.

Nút **Copy mốc 00:00 Ph** chỉ sao chép từng mốc; biểu tượng **Xuất timeline** mở Save As và ghi các dòng `00:00 Ph Video_001`. Ứng dụng không tự tạo timeline CSV/JSON.

## Ý nghĩa Highest Quality

- Không tự hạ 4K/60 FPS khi profile không giới hạn.
- Không upscale mặc định.
- Không encode lại file đã tương thích.
- Nếu bắt buộc đồng nhất để concat, target dùng canvas của source thật có độ phân giải cao nhất và FPS cao nhất.
- Thành phẩm được tạo ở trạng thái pending, verify thành công rồi mới thay thế file cũ.
- Tệp `.part/.ytdl/.aria2`, clip, concat và normalize tạm được dọn sau khi quy trình hoàn tất; tệp tùy ý của user được giữ nguyên.

## Nhật ký và lỗi

Mỗi list có log riêng trên giao diện và file riêng trong `logs\projects`. Lỗi cookies, tool, ổ đĩa, quyền thư mục hoặc mạng/CDN lặp lại sẽ Pause list thay vì tạo hàng loạt lỗi. Có thể xuất **Diagnostic bundle** trong trang Nhật ký.

## Khi đóng ứng dụng

Chọn **Pause và đóng** để job được đánh dấu interrupted và tiếp tục ở lần mở sau. Không nên End Task trong Task Manager.


## Cập nhật v0.4.0

- 1–4 danh sách tải độc lập và 1–4 pipeline tải-ghép độc lập.
- Mỗi khu vực có nút điều khiển theo trạng thái, progress/log riêng và chức năng dọn lịch sử.
- Cookies hỗ trợ trình duyệt, dán trực tiếp và file TXT.
- Lỗi quan trọng hiển thị bằng cảnh báo tiếng Việt nổi bật; chi tiết kỹ thuật được thu gọn.
- Menu native đã được gỡ; giao diện có loading state, animation và phản hồi cho thao tác chính.


## CPU tự động v0.5.1

Trong `Cài đặt → Xử lý`, chọn `CPU tự động · khuyến nghị`. Ứng dụng dùng libx264 cho H.264 và libx265 cho HEVC. Nếu NVENC không tương thích driver hoặc lỗi giữa tác vụ, backend tự chạy lại bằng CPU.

## Cập nhật v0.5.0

- Cả hai workflow hiển thị cùng trạng thái Tool Center; có thể Health Check ngay tại màn hình đang làm việc.
- Nút **Xóa danh sách** và **Xóa pipeline** dọn queue, dữ liệu nhập và log trong ứng dụng nhưng không xóa file media trên ổ đĩa.
- Trang Tiến trình cho phép xóa từng dòng đã kết thúc hoặc dọn hàng loạt theo khu vực.
- Giao diện Aurora responsive hiển thị tốt hơn ở cửa sổ nhỏ; animation tự giảm khi Windows bật Reduce Motion.
- Thông tin nhà phát triển: **Đình Duy Tubmedia**.
