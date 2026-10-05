import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cpuCountsFromWmi } from '../../src/main/settings/hardware-service.js';

// Khám phá bản cài 2026-10-05, vấn đề #5: máy 2 × Xeon E5-2696 v3 (18 nhân/36 luồng mỗi CPU) hiện "Luồng xử lý
// 36" thay vì 72. os.cpus() trên Windows chỉ đếm MỘT nhóm bộ xử lý (processor group, tối đa 64 luồng và Windows
// chia 72 luồng thành 2 nhóm × 36). Đã kiểm trên máy thật: os.cpus().length = 36, WMI Win32_Processor trả 2 dòng
// NumberOfCores=18, NumberOfLogicalProcessors=36.

describe('#5 — đếm luồng/nhân theo WMI cho máy nhiều CPU', () => {
  it('máy thật 2 CPU: 72 luồng, 36 nhân (không còn 36 luồng)', () => {
    const rows = [
      { Name: 'Intel(R) Xeon(R) CPU E5-2696 v3 @ 2.30GHz', NumberOfCores: 18, NumberOfLogicalProcessors: 36 },
      { Name: 'Intel(R) Xeon(R) CPU E5-2696 v3 @ 2.30GHz', NumberOfCores: 18, NumberOfLogicalProcessors: 36 }
    ];
    expect(cpuCountsFromWmi(rows, 36)).toEqual({ logical: 72, physical: 36 });
  });

  it('máy 1 CPU: giữ đúng như trước', () => {
    expect(cpuCountsFromWmi([{ NumberOfCores: 8, NumberOfLogicalProcessors: 16 }], 16)).toEqual({ logical: 16, physical: 8 });
  });

  it('WMI lỗi/không có dữ liệu → lùi về os.cpus() như trước (nhân = luồng / 2)', () => {
    expect(cpuCountsFromWmi([], 36)).toEqual({ logical: 36, physical: 18 });
    expect(cpuCountsFromWmi([{ NumberOfCores: 'x', NumberOfLogicalProcessors: null }], 12)).toEqual({ logical: 12, physical: 6 });
  });

  it('không bao giờ báo ít luồng hơn số Node đã thấy', () => {
    expect(cpuCountsFromWmi([{ NumberOfCores: 2, NumberOfLogicalProcessors: 4 }], 8)).toEqual({ logical: 8, physical: 2 });
  });

  it('detect() dùng cpuCountsFromWmi cho cả luồng và nhân (test canh mã nguồn)', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/settings/hardware-service.ts'), 'utf8');
    const detect = source.slice(source.indexOf('public async detect()'), source.indexOf('public recommend('));
    expect(detect).toContain('cpuCountsFromWmi(');
    expect(detect).not.toMatch(/logicalCpuCount:\s*cpuList\.length/);
  });
});
