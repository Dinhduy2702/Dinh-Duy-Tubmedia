import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(join(process.cwd(), 'src/renderer/src/components/QuickDownloadPanel.tsx'), 'utf8');

describe('ô nhập mốc thời lượng video', () => {
  it('không dùng đồng hồ giờ trong ngày', () => {
    expect(panel).not.toContain('type="time"');
    expect(panel).toContain('Mốc thời lượng bắt đầu');
    expect(panel).toContain('Mốc thời lượng kết thúc');
  });

  it('nhập HH:MM:SS và không hiển thị AM/PM', () => {
    expect(panel).toContain('pattern="[0-9:]*"');
    expect(panel).toContain('placeholder="00:10:00"');
    expect(panel).toContain('placeholder="00:13:00"');
    expect(panel).toContain('Hai mốc được tự động lưu khi thêm link và khi mở lại ứng dụng');
    expect(panel).not.toContain('type="time"');
  });

  it('chỉ hiện Timeline khi bật dấu tích', () => {
    expect(panel).toContain('checked={useTimeline}');
    expect(panel).toContain('{useTimeline && (');
    expect(panel).toContain('quick-download-timeline-editor');
  });

  it('giữ giá trị bắt đầu và kết thúc trong state hiện tại', () => {
    expect(panel).toContain('value={startTime}');
    expect(panel).toContain('setStartTime');
    expect(panel).toContain('value={endTime}');
    expect(panel).toContain('setEndTime');
  });

  it('giữ mặc định 10 phút và 13 phút', () => {
    expect(panel).toContain("'00:10:00'");
    expect(panel).toContain("'00:13:00'");
  });
});
