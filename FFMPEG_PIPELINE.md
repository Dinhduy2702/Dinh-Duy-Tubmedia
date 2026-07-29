# FFmpeg Pipeline

1. FFprobe đọc codec, profile, level, resolution, FPS, time base, pixel format, HDR và audio.
2. Quality Decision chọn COPY, REMUX, VIDEO/AUDIO/FULL TRANSCODE, HDR_TONEMAP hoặc ADD_SILENT_AUDIO.
   Video và audio được đối chiếu độc lập: chỉ audio lệch thì `-c:v copy`; chỉ video lệch thì audio tương thích được `-c:a copy`.
3. FFmpeg nhận thread/filter limits từ Resource Profile.
4. Output tạm có hậu tố `.pending.mp4`.
5. Standard/Deep verification chạy trước atomic rename.
6. Merge dùng concat demuxer + stream copy sau khi các input tương thích.
7. Sau khi thành phẩm hợp lệ, dọn concat, normalize, clip và các phần tải tạm đã được Tubmedia nhận diện.
