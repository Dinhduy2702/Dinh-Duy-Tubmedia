import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BrowserCookieLockedError, ToolNotFoundError } from '../../src/shared/errors/app-errors.js';
import { encodeTypedMessage } from '../../src/shared/utils/notice-tone.js';
import { friendlyIssue, safeUiText } from '../../src/shared/utils/ui-error.js';

const completedDownloadResult = {
  url: 'https://youtube.com/watch?v=aOxM86XkvK8',
  displayName: 'Incredible BABOON HUNTING day with FEARLESS Hadzabe tribe Hunters',
  workflow: 'download-only',
  progressStage: 'Đã hoàn tất',
  progressPhases: [
    { key: 'analyze', label: 'Phân tích nguồn', percent: 100, state: 'completed' },
    { key: 'download', label: 'Tải video', percent: 100, state: 'completed' },
    { key: 'verify', label: 'Kiểm tra tệp', percent: 100, state: 'completed' },
    { key: 'finalize', label: 'Đã hoàn tất', percent: 100, state: 'completed' }
  ],
  outputPath: 'E:\\DinhDuy\\video.mp4',
  resultMessage: 'Đã tải và kiểm tra hoàn tất: E:\\DinhDuy\\video.mp4',
  reusedExistingFile: false,
  cookieFailureConfirmed: false,
  cookieRetryRequested: false
};

describe('user-facing notification boundary', () => {
  it('classifies a completed structured result as success instead of an error', () => {
    const issue = friendlyIssue(completedDownloadResult);
    expect(issue.tone).toBe('success');
    expect(issue.title).toBe('Đã hoàn tất');
    expect(issue.message).not.toContain('progressPhases');
    expect(issue.message).not.toContain('cookieFailureConfirmed');
    expect(issue.message).not.toContain('{');
  });

  it('also recognizes the same result when an IPC layer serialized it as JSON', () => {
    const issue = friendlyIssue(JSON.stringify(completedDownloadResult, null, 2));
    expect(issue.tone).toBe('success');
    expect(issue.message).toContain('Tệp đã được tải');
  });

  it('classifies electron-updater same-version output as neutral information', () => {
    const raw = 'Update for version 1.3.0 is not available (latest version: 1.3.0, downgrade is allowed).';
    const issue = friendlyIssue(raw);
    expect(issue.tone).toBe('info');
    expect(issue.title).toBe('Ứng dụng đã được cập nhật');
    expect(issue.message).toBe('Bạn đang sử dụng phiên bản mới nhất.');
    expect(issue.message.toLowerCase()).not.toContain('downgrade');
    expect(safeUiText(raw)).toBe('Bạn đang sử dụng phiên bản mới nhất.');
  });

  it('never exposes stacks, metadata or raw objects in a visible message', () => {
    const stack = friendlyIssue(new Error('TypeError: boom\n at Object.x (a.ts:1:2)'));
    const object = friendlyIssue({ eventCode: 'JOB_FAILED', jobId: 'abc', metadata: { raw: true } });
    expect(stack.message).not.toContain('Object.x');
    expect(object.message).not.toContain('eventCode');
    expect(object.message).not.toContain('jobId');
    expect(safeUiText('[object Object]')).not.toBe('[object Object]');
  });

  it('does not render raw queue input or technical blocks in normal UI', () => {
    const queue = readFileSync('src/renderer/src/pages/QueuePage.tsx', 'utf8');
    const attention = readFileSync('src/renderer/src/components/AttentionCenter.tsx', 'utf8');
    const app = readFileSync('src/renderer/src/app/App.tsx', 'utf8');
    const boundary = readFileSync('src/renderer/src/components/RendererErrorBoundary.tsx', 'utf8');
    const projects = readFileSync('src/renderer/src/pages/ProjectsPage.tsx', 'utf8');
    const tools = readFileSync('src/renderer/src/pages/ToolsPage.tsx', 'utf8');
    expect(queue).not.toContain('JSON.stringify(detailJob.input');
    expect(queue).not.toContain('<pre>{issue.technical}</pre>');
    // Giai đoạn 2 (2026-09-25) — Phát hiện kiến trúc số 3: AttentionCenter giờ CÓ hiển thị
    // issue.technical, nhưng CHỈ trong khung "Chi tiết kỹ thuật" gấp lại mặc định
    // (attention-technical-wrap + state technicalOpen) — không phải hiện thẳng, không điều kiện.
    expect(attention).not.toContain('<pre>{issue.technical}</pre>');
    expect(attention).toContain('attention-technical-wrap');
    expect(attention).toContain('technicalOpen');
    expect(app).not.toContain('{issue.technical}');
    expect(app).toContain('safeUiText(startupToolMessage');
    expect(boundary).not.toContain('error.stack');
    expect(projects).not.toContain('{x.errorMessage??');
    expect(projects).not.toContain('<td>{x.message}</td>');
    expect(tools).not.toContain('<span>{tool.error}</span>');
  });

  it('treats exhausted HTTP 403 and fragment interruptions as recoverable warnings', () => {
    const forbidden = friendlyIssue(
      'Máy chủ video vẫn từ chối yêu cầu (HTTP 403) sau 3 lần thử. Tubmedia đã giữ tệp .part.'
    );
    const fragment = friendlyIssue(
      'Dữ liệu video vẫn bị gián đoạn sau 3 lần thử. Tubmedia đã giữ tệp .part.'
    );

    expect(forbidden.tone).toBe('warning');
    expect(forbidden.title).toContain('Máy chủ video');
    expect(fragment.tone).toBe('warning');
    expect(fragment.title).toContain('Luồng tải video');
  });

  it('tells the user how to finish closing a browser that keeps the cookie database locked', () => {
    // Sự cố thật 2026-09-25: đóng cửa sổ Chrome/Edge KHÔNG đủ — trình duyệt có thể vẫn chạy ẩn
    // trong nền (xác nhận bằng kiểm thử thật: tiến trình chrome.exe chính vẫn sống sau khi đóng
    // cửa sổ, khóa file Cookies khiến CẢ lệnh copy thường của hệ điều hành cũng báo "resource busy",
    // không riêng gì yt-dlp). Thông báo cũ chỉ nói "đóng hoàn toàn... kể cả tiến trình chạy nền"
    // nhưng không nói CÁCH làm — người dùng thường không biết mở Task Manager để kết thúc tác vụ.
    const error = new BrowserCookieLockedError('Chrome');
    const issue = friendlyIssue(error.message);
    const allSteps = issue.steps.join(' ');
    expect(issue.title).toBe('Trình duyệt đang khóa dữ liệu đăng nhập');
    expect(allSteps).toContain('Task Manager');
    expect(allSteps).toContain('chrome.exe');
    expect(allSteps.toLowerCase()).toContain('kết thúc tác vụ');
  });

  // Giai đoạn 2 (2026-09-25) — Phát hiện kiến trúc số 1: một lỗi có MÃ đã biết nhưng nội dung chữ
  // không khớp cụm nào ở classifyIssue() từng bị GHI ĐÈ thành tiêu đề chung chung và MẤT SẠCH gợi ý
  // hành động — tệ hơn một lỗi lạ không có mã. Xác nhận đã sửa: tiêu đề đúng ngữ cảnh + vẫn còn gợi ý.
  it('gives a code-aware title and keeps helpful steps for a known error code with no matching phrase', () => {
    const error = new ToolNotFoundError('ffmpeg');
    const wire = encodeTypedMessage('error', 'TOOL_NOT_FOUND', error.message);
    const issue = friendlyIssue(wire);
    expect(issue.title).toBe('Thiếu công cụ xử lý video');
    expect(issue.title).not.toBe('Không thể hoàn tất thao tác');
    expect(issue.steps.length).toBeGreaterThan(0);
    expect(issue.code).toBe('TOOL_NOT_FOUND');
  });

  // Giai đoạn 2 (2026-09-25) — Phát hiện kiến trúc số 2: một số message viết tay nhét thẳng lỗi hệ
  // điều hành thô (vd merge-engine.ts: `Không thể commit thành phẩm an toàn: ${String(error)}`) —
  // isTechnicalText() cũ không bắt được dạng "Nhãn: LỖI_THÔ" nên lộ nguyên văn ra thông báo chính.
  it('replaces a leaked raw OS error inside a hand-written message with a safe fallback, keeps it in technical', () => {
    const raw =
      "Không thể commit thành phẩm an toàn: EPERM: operation not permitted, rename 'E:\\a.mp4' -> 'E:\\b.mp4'";
    const wire = encodeTypedMessage('error', 'MERGE_FAILED', raw);
    const issue = friendlyIssue(wire);
    expect(issue.title).toBe('Không thể ghép video');
    expect(issue.message).not.toContain('EPERM');
    expect(issue.message).not.toContain('E:\\a.mp4');
    expect(issue.steps.length).toBeGreaterThan(0);
    expect(issue.technical).toContain('EPERM');
  });

  // Giai đoạn 3 (2026-09-25) — rà lại bảng kiểm kê sau kiến trúc: các mã có message LUÔN theo một
  // khuôn cố định (một điểm gọi duy nhất) được thay hẳn message/steps bằng nội dung đã duyệt.
  it('replaces the whole message for single-shape codes like TOOL_HEALTH_CHECK_FAILED and PROCESS_TIMEOUT', () => {
    const health = friendlyIssue(encodeTypedMessage('error', 'TOOL_HEALTH_CHECK_FAILED', 'ffmpeg: exit code 3221225781'));
    expect(health.title).toBe('Công cụ xử lý video hoạt động bất thường');
    expect(health.message).not.toContain('exit code');
    expect(health.message).not.toContain('ffmpeg');
    expect(health.steps.length).toBeGreaterThan(0);

    const timeout = friendlyIssue(encodeTypedMessage('warning', 'PROCESS_TIMEOUT', 'yt-dlp vượt quá thời gian cho phép 300 giây.'));
    expect(timeout.title).toBe('Một bước xử lý chạy quá lâu');
    expect(timeout.message).not.toContain('yt-dlp');
    expect(timeout.steps.length).toBeGreaterThan(0);
  });

  // SOURCE_REMOVED đã có message viết tay rất tốt từ trước (giữ nguyên) — Giai đoạn 3 chỉ thêm gợi ý
  // hành động còn thiếu, không đụng vào nội dung đã tốt.
  it('keeps the already-good SOURCE_REMOVED message but adds the missing action step', () => {
    const wire = encodeTypedMessage(
      'neutral',
      'SOURCE_REMOVED',
      'Video này đã bị xóa khỏi YouTube nên không thể tải. Tubmedia đã bỏ qua video này.'
    );
    const issue = friendlyIssue(wire);
    expect(issue.title).toBe('Video không còn khả dụng');
    expect(issue.message).toBe('Video này đã bị xóa khỏi YouTube nên không thể tải. Tubmedia đã bỏ qua video này.');
    expect(issue.steps).toContain('Hãy kiểm tra lại link hoặc bỏ qua video này.');
  });

  // Giai đoạn 3 (2026-09-25): PROCESSING_FAILED/MERGE_FAILED đôi khi dùng thẳng stderrTail của FFmpeg —
  // log FFmpeg có định dạng đặc trưng ("[bộ_mã_hóa @ 0x...]", "Stream #0:0") phải bị chặn khỏi nội dung
  // chính, nhưng KHÔNG được đụng vào một message đã tốt của cùng mã (vd "Mốc cắt không hợp lệ...").
  it('blocks raw FFmpeg log output but keeps an already-clear message for the same code', () => {
    const leaked = friendlyIssue(
      encodeTypedMessage(
        'error',
        'PROCESSING_FAILED',
        "[libx264 @ 0x55d2a1b2c3d0] frame=  120 fps=0 Stream #0:0: Invalid data found"
      )
    );
    expect(leaked.message).not.toContain('libx264');
    expect(leaked.message).not.toContain('Stream #0:0');

    const clear = friendlyIssue(
      encodeTypedMessage(
        'error',
        'PROCESSING_FAILED',
        'Mốc cắt không hợp lệ: thời điểm kết thúc phải lớn hơn thời điểm bắt đầu và các mốc không được âm.'
      )
    );
    expect(clear.message).toBe(
      'Mốc cắt không hợp lệ: thời điểm kết thúc phải lớn hơn thời điểm bắt đầu và các mốc không được âm.'
    );
  });
});
