# System Design — Tubmedia Next

## Luồng tổng thể

```text
React Renderer
  -> Preload API tối thiểu
  -> IPC + Zod validation
  -> Application Services
  -> Job State Machine / Queue Scheduler
  -> Download | Clip | Normalize | Merge
  -> ProcessManager (yt-dlp/aria2c/ffmpeg/ffprobe)
  -> Atomic files + SQLite repositories
  -> sequenced events trở lại Renderer
```

## Thành phần giữ lại

- Electron shell, BrowserWindow sandbox và preload typed API.
- React/Zustand renderer.
- SQLite repositories/migrations/WAL.
- Queue dependency graph và resource profiles.
- yt-dlp/aria2c/FFmpeg/ffprobe integration.
- Smart Merge theo nguyên tắc normalize có chọn lọc và concat `-c copy`.
- NSIS/electron-builder release pipeline.

## Thành phần đã harden

- Download defaults và migration source quality.
- Safe output collision handling.
- File ownership sentinel và cleanup policy.
- Backend job transition table.
- Mute-only stream copy.
- Fit/pad no-upscale normalization.
- HDR/rotation/SAR/DAR/VFR media model.
- Restore gate/integrity/relaunch.
- SHA-256 fail-closed tool updater.
- Installer identity/scripts tự chứa.

## Thành phần chưa hoàn tất

- Native Windows Job Objects và PID creation-token verification.
- Sequence/version cho event UI để bỏ event cũ toàn diện.
- Backup kèm media thật; hiện backend từ chối rõ ràng thay vì giả thành công.
- UI redesign đầy đủ, visual regression và scaling matrix.
- Media fixture matrix chạy bằng FFmpeg thật.
- Signed installer, clean/upgrade/uninstall/reinstall trên Windows VM.
