import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTICE_TONES } from '../../src/shared/utils/notice-tone.js';

const root = process.cwd();
const source = (path: string): string => readFileSync(join(root, path), 'utf8');

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const rendererFiles = walk(join(root, 'src/renderer/src')).filter((file) => /\.tsx?$/.test(file));

describe('thành phần thông báo luôn có biểu tượng + chữ, không chỉ màu', () => {
  it('mỗi mức có một biểu tượng KHÁC HÌNH DẠNG', () => {
    const icons = source('src/renderer/src/components/ui/ToneIcon.tsx');
    for (const name of ['XCircle', 'AlertTriangle', 'CheckCircle2', 'CircleMinus', 'Info']) {
      expect(icons).toContain(`<${name} `);
    }
    expect(icons).toContain('aria-hidden="true"');
  });

  it('Notice hiển thị biểu tượng, nhãn chữ của mức và vai trò trợ năng', () => {
    const notice = source('src/renderer/src/components/ui/Notice.tsx');
    expect(notice).toContain('<ToneIcon tone={tone} />');
    expect(notice).toContain('NOTICE_TONE_LABEL[tone]');
    expect(notice).toContain('noticeAriaRole(tone)');
    expect(notice).toContain('tone-${tone}');
  });

  it('StatusBadge chọn màu theo mức (không còn bảng màu riêng cho từng trạng thái) và luôn có biểu tượng + chữ', () => {
    const badge = source('src/renderer/src/components/StatusBadge.tsx');
    expect(badge).toContain('toneForStatus(');
    expect(badge).not.toContain('STATUS_COLORS');
    expect(badge).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(badge).toContain('statusIcon(lower, tone)');
    expect(badge).toContain('<span>{label}</span>');
  });

  it('thông báo nổi có nhãn mức, biểu tượng, và chỉ lỗi mới không tự tắt', () => {
    const toast = source('src/renderer/src/components/AttentionCenter.tsx');
    expect(toast).toContain('NOTICE_TONE_LABEL[tone]');
    expect(toast).toContain('<ToneIcon tone={tone}');
    expect(toast).toContain('isPersistentNoticeTone(tone)');
    expect(toast).toContain('aria-label="Đóng thông báo"');
    expect(toast).toContain('tone-${tone}');
  });

  it('khung chẩn đoán lấy mức từ MỨC DÒNG NHẬT KÝ chứ không đoán từ chữ', () => {
    const dock = source('src/renderer/src/components/DiagnosticDock.tsx');
    expect(dock).toContain("log?.level === 'error' ? 'error' : log?.level === 'warn' ? 'warning' : 'info'");
    expect(dock).toContain('NOTICE_TONE_LABEL[tone]');
    expect(dock).toContain('<ToneIcon tone={tone}');
  });

  it('Trung tâm thông báo có nhãn mức và biểu tượng cho mọi mức', () => {
    const center = source('src/renderer/src/components/NotificationCenter.tsx');
    expect(center).toContain('NOTICE_TONE_LABEL[notification.severity]');
    expect(center).toContain('<ToneIcon tone={notification.severity} />');
  });
});

describe('mã nguồn giao diện không tự chọn màu', () => {
  it('không còn mã màu #rrggbb viết cứng trong TSX (mọi màu đi qua biến CSS)', () => {
    const offenders: string[] = [];
    for (const file of rendererFiles) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/['"`]#[0-9a-fA-F]{6}['"`]/g)) offenders.push(`${file}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('vị trí và hành vi của thông báo nổi', () => {
  it('thông báo nổi và khung chẩn đoán nằm chung một cột ở góc dưới-phải, không che tiêu đề trang', () => {
    const app = source('src/renderer/src/app/App.tsx');
    expect(app).toMatch(/<div className="notice-stack">\s*<AttentionCenter \/>\s*<DiagnosticDock \/>\s*<\/div>/);
    const css = source('src/renderer/src/tokens.css');
    const stack = /\.notice-stack \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(stack).toContain('position: fixed');
    expect(stack).toContain('bottom: 16px');
    expect(stack).toContain('right: 16px');
    expect(stack).not.toMatch(/\btop:/);
    const toast = /\.notice-stack \.attention-center,\s*\.notice-stack \.diagnostic-dock \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(toast).toContain('position: relative');
    expect(toast).toContain('transform: none');
  });

  it('thông báo nổi chỉ dịch chuyển bằng transform/opacity (không animate width/height/blur)', () => {
    const css = source('src/renderer/src/tokens.css');
    const block = /\.notice-stack \.attention-center \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toContain('transition:');
    expect(block).toMatch(/opacity 220ms/);
    expect(block).toMatch(/transform 220ms/);
    expect(block).not.toMatch(/filter|backdrop|width|height|blur/);
  });
});

describe('không còn thông báo "tự đoán mức"', () => {
  it('không còn setError với chuỗi cố định (chuỗi cố định phải dùng showNotice với mức rõ ràng)', () => {
    const offenders: string[] = [];
    for (const file of rendererFiles) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/setError\(\s*['"`]/g)) offenders.push(`${file}@${match.index}`);
    }
    expect(offenders).toEqual([]);
  });

  it('mọi showNotice dùng đúng một mức hợp lệ, và kết quả hủy/không có gì là mức trung tính', () => {
    const tones = new Set<string>(NOTICE_TONES);
    const seen: string[] = [];
    for (const file of rendererFiles) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/showNotice\(\s*'([a-z]+)'\s*,\s*'([^']*)'/g)) {
        expect(tones.has(match[1] ?? ''), `${file}: ${match[1]}`).toBe(true);
        seen.push(`${match[1]}|${match[2]}`);
        if (/hủy|tạm dừng|bỏ qua/i.test(match[2] ?? '')) expect(match[1], match[2]).toBe('neutral');
      }
    }
    expect(seen.length).toBeGreaterThanOrEqual(8);
  });

  it('hủy / tạm dừng không còn được báo bằng mức cảnh báo (vàng) ở các trang danh sách và hàng đợi', () => {
    for (const file of [
      'src/renderer/src/pages/DownloadWorkbenchPage.tsx',
      'src/renderer/src/pages/DownloadMergePage.tsx',
      'src/renderer/src/pages/QueuePage.tsx',
      'src/renderer/src/layout/Topbar.tsx'
    ]) {
      const text = source(file);
      expect(text, file).not.toMatch(/action === 'cancel' \? 'warning'/);
      expect(text, file).not.toMatch(/allPaused \? 'success' : 'warning'/);
    }
    expect(source('src/renderer/src/layout/Topbar.tsx')).toContain("queueSummary.allPaused ? 'success' : 'neutral'");
    expect(source('src/renderer/src/pages/QueuePage.tsx')).toContain("allPaused ? 'success' : 'neutral'");
  });

  it('cập nhật không thành công chỉ là cảnh báo (ứng dụng hiện tại vẫn dùng được), không đỏ', () => {
    const page = source('src/renderer/src/pages/UpdatesPage.tsx');
    expect(page).toContain("if (state === 'error') return 'warning';");
    expect(page).toContain('<Notice');
    expect(page).toContain('Tubmedia hiện tại vẫn dùng bình thường, không mất dữ liệu.');
  });

  it('màu thông điệp ở hàng đợi theo MỨC của sự cố, không tô đỏ mọi sự cố', () => {
    const queue = source('src/renderer/src/pages/QueuePage.tsx');
    expect(queue).toContain('toneTextVar(issue.tone)');
    expect(queue).toContain('detailToneFor(issue.tone)');
    expect(queue).not.toMatch(/issue\s*\?\s*'var\(--bad\)'/);
    expect(queue).not.toMatch(/issue\s*\?\s*'danger'/);
  });

  it('hộp thoại gốc của trình duyệt chỉ còn ở trang Dọn dẹp cũ (sẽ thay khi viết lại ở Giai đoạn 4)', () => {
    const withNative = rendererFiles.filter((file) => /window\.(?:confirm|prompt|alert)\(/.test(readFileSync(file, 'utf8')));
    expect(withNative.map((file) => file.replace(/\\/g, '/').split('/src/renderer/src/')[1])).toEqual([
      'components/SystemCleanupPanel.tsx'
    ]);
  });
});
