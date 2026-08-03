# CHANGED FILES — TUBMEDIA 1.3.0

## Version và phát hành nội bộ

- `package.json`, `package-lock.json`: nâng version lên 1.3.0, thêm workflow verifier.
- `src/shared/constants/app.ts`: nhãn v1.3.0.
- `CHANGELOG.md`: ghi thay đổi 1.3.0.
- `BUILD_INSTALLER_CHINH_THUC.ps1`: pipeline 1.3.0 và gate mới.
- `source-manifest.json`: khai báo file mới.

## UI/UX

- `Sidebar.tsx`: điều hướng theo nhóm và chuyển Cleanup xuống Advanced Tools.
- `App.tsx`, `app-store.ts`: route mới và Editor Home mặc định.
- `EditorHomePage.tsx`: dashboard workflow thật.
- `QueuePage.tsx`: search/filter/multi-select/virtualization/detail/safe delete.
- `HistoryPage.tsx`: history + native CSV/JSON export.
- `DiagnosticsPage.tsx`: tools/stats/errors thật.
- `ImportLinksDialog.tsx`: TXT/CSV/drag-drop/preview/dedupe.
- `WorkflowCard.tsx`, `VirtualTableWindow.tsx`: component mới.
- `tubmedia-theme.css`, `quick-download.css`: hệ thống giao diện 1.3 và responsive.

## Quick Download/backend

- `src/shared/quick-download.ts`: media modes và sidecar options.
- `quick-download-command.ts`: command thật cho audio/video-only, subtitles, thumbnail, metadata.
- `quick-download-service.ts`: migration trạng thái, status mediaMode, stream-aware verification.
- `file-verifier.ts`: expected video/audio streams.
- `QuickDownloadPanel.tsx`: UI mới và điều khiển pause/resume/cancel.

## Preset editor

- `src/main/settings/defaults.ts`: Premiere CFR, Resolve CFR, CapCut CFR, proxy 720p.

## Kiểm thử và source integrity

- `verify-editor-workflows-1.3.0.mjs`: 18 workflow checks.
- `editor-workflows-1.3.0.test.ts`: unit/static regression.
- `verify-quick-download-integration.mjs`: mở rộng thành 17 checks.
- `verify-release-candidate.mjs`, `verify-stable-release.mjs`: chấp nhận Queue Studio mới nhưng vẫn giữ yêu cầu detail/safe delete.
- `generate-source-inventory.mjs`, `verify-source-completeness.mjs`: bỏ generated cache khỏi workspace, strict-clean vẫn cấm.
