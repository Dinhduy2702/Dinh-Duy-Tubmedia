# AUDIT FIX MATRIX — TUBMEDIA 1.3.0

| Mã | Vấn đề | Trạng thái | Bằng chứng | Test/Gate |
|---|---|---|---|---|
| SRC-01 | Source thiếu module/installer | Đã sửa | manifest + completeness verifier | `verify:source-completeness` |
| BLD-01 | Source check quét `node_modules`/`.tsbuildinfo` | Đã sửa | strict-clean và installed-workspace mode | completeness gate |
| QD-01 | Quick Download nằm ngoài process lifecycle | Đã sửa | AppContext + ProcessManager | quick-download gate |
| QD-02 | Mốc >23 giờ/reset khi đổi link | Đã sửa | localStorage + elapsed parser | duration tests/gate |
| QD-03 | Thiếu audio/video-only và sidecar | Đã sửa | mediaMode + yt-dlp flags | quick-download tests/gate |
| QD-04 | Báo completed trước kiểm tra stream | Đã sửa | expectedStreams trong FileVerifier | service test/gate |
| UI-01 | Giao diện chưa có workflow editor rõ | Đã sửa | Editor Home + grouped sidebar | editor-workflow gate |
| UI-02 | System Cleanup chiếm vị trí core | Đã sửa | đưa vào Công cụ nâng cao | editor-workflow gate |
| QUE-01 | Queue thiếu search/filter/multi-select | Đã sửa | Queue Studio | editor-workflow unit/gate |
| QUE-02 | Queue lớn render toàn bộ | Đã sửa | `useVirtualTableWindow` | editor-workflow gate |
| QUE-03 | Xóa tác vụ thiếu lựa chọn an toàn | Đã sửa | record-only hoặc deleteOutput qua backend ownership | stable verifier |
| INP-01 | Thiếu TXT/CSV/kéo thả | Đã sửa | Import Links mới | editor-workflow gate |
| INP-02 | Trùng URL/title bị xử lý không rõ | Đã sửa ở bước import | identity URL+mốc+audioMode | editor-workflow gate |
| HIS-01 | Thiếu lịch sử export | Đã sửa | native CSV/JSON save | editor-workflow gate |
| DIA-01 | Thiếu chẩn đoán tập trung | Đã sửa | ToolManager/SystemStats/Logs | editor-workflow gate |
| NLE-01 | Thiếu preset editor/CFR/proxy | Đã sửa | 4 built-in quality profiles | editor-workflow gate |
| MRG-01 | Encode toàn bộ không cần thiết | Đã có sẵn và giữ nguyên | Smart Merge/cache/remux | audit-hardening |
| SEC-01 | Ghi đè/path/secret/IPC | Đã có sẵn và giữ nguyên | collision/path policy/redaction/sender validation | audit gates |
| PLS-01 | Playlist analyze/chọn item quy mô lớn | Chưa sửa hoàn chỉnh | chưa có chuyên trang metadata item | Remaining Issues |
| WIN-01 | Job Object/PID reuse test thực | Chưa xác minh | cần Windows process test | Remaining Issues |
| MED-01 | Fixture HDR/VFR/SAR/rotation/5.1 đầy đủ | Chưa xác minh | cần suite media thực | Remaining Issues |
