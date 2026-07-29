# Verification 0.2.0

Đã chạy trong môi trường tạo gói:

- TypeScript/TSX syntax transpile scan: PASS.
- Domain runtime checks: PASS.
  - timestamp parsing
  - input parsing và duplicate source warning
  - audio note inference
  - filename sanitization
  - highest-quality merge target
- SQLite migrations: PASS.
  - 2 migrations
  - 22 tables
  - `PRAGMA integrity_check = ok`

Chưa chạy trong container do npm registry timeout:

- Full `npm install`
- Full `tsc --noEmit` với dependency thật
- ESLint
- Vitest bằng dependency thật
- electron-vite build
- NSIS installer

Trên máy Windows, bắt buộc chạy:

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run dev
npm.cmd run dist
```

Không tuyên bố installer đã được xác minh nếu các bước trên chưa pass trên Windows.
