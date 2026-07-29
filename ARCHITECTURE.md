# Kiến trúc 0.2.0

```text
Electron Renderer (React)
  └─ typed preload bridge
       └─ Zod-validated IPC
            └─ Electron Main
                ├─ WorkbenchService
                ├─ QueueManager
                ├─ DownloadEngine (yt-dlp)
                ├─ ClipEngine / NormalizeEngine / MergeEngine (FFmpeg)
                ├─ MediaAnalyzer / FileVerifier (ffprobe)
                ├─ ProcessManager
                ├─ ToolManager
                └─ node:sqlite repositories
```

Production dùng `loadFile(out/renderer/index.html)`. `localhost:5173` chỉ xuất hiện trong `npm run dev` của Vite và không tồn tại trong installer production.

## Workbench thay cho thao tác copy tool

Ba session cố định được lưu trong SQLite:

- `__WORKBENCH_DOWNLOAD_A__`
- `__WORKBENCH_DOWNLOAD_B__`
- `__WORKBENCH_DOWNLOAD_MERGE__`

Người dùng không phải tạo/copy source code. Các session này là implementation detail; frontend chỉ hiển thị hai workflow trực tiếp.

## Đồng thời và khóa tài nguyên

- Queue round-robin theo session/project.
- Download worker limit theo Resource Profile của từng session.
- Source lock ngăn hai worker tải cùng source.
- Normalize mặc định một worker.
- CPU/RAM/disk guard chặn job nặng mới khi tài nguyên không đủ.
- ProcessManager dùng `spawn(..., { shell:false })`, AbortController và kill process tree trên Windows.
