# Security Model

## Đã có

- `contextIsolation=true`, `nodeIntegration=false`, `sandbox=true`, `webSecurity=true`.
- IPC input Zod và sender validation.
- Spawn process không qua shell.
- External navigation/window bị chặn.
- Tool updater từ chối asset không có SHA-256.
- Restore kiểm tra schema/integrity/foreign keys.
- Cleanup yêu cầu ownership marker.

## Cần tiếp tục

- Runtime schema cho IPC output.
- Diagnostic exporter phải scrub secret trước khi copy log thô.
- Path capability/ownership token thay vì chỉ nhận chuỗi path.
- Code signing app/installer và signed update manifest.
- Secret scan và tampered-update test trong CI Windows.
