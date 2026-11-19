import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  defaultReadRecycleBinCapacity,
  parseWindowsRecycleBinVolumeLine
} from '../../src/main/files/post-merge-source-cleanup.js';

const EXPECTED_FAIL_CLOSED_REASON =
  'Không kiểm tra được sức chứa Thùng rác trên ổ này nên Tubmedia dừng để tránh xóa vĩnh viễn video nguồn';

function findUnusedDriveRoot(): string | null {
  for (const letter of ['Z', 'Y', 'X', 'W', 'V', 'Q']) {
    const root = `${letter}:\\`;
    if (!existsSync(root)) return `${root}tubmedia-khong-ton-tai`;
  }
  return null;
}

describe('V15 — Kiểm tra sức chứa Thùng rác theo hướng fail-closed an toàn', () => {
  it('kết quả rỗng hoặc NO_VOL phải fail-closed (supported: false, maxBytes: 0) kèm lý do tiếng Việt rõ ràng', () => {
    const fromEmpty = parseWindowsRecycleBinVolumeLine('', 'E:', 50 * 1024 ** 3);
    expect(fromEmpty).toEqual({
      supported: false,
      maxBytes: 0,
      reason: EXPECTED_FAIL_CLOSED_REASON
    });

    const fromNoVol = parseWindowsRecycleBinVolumeLine('NO_VOL', 'E:', 50 * 1024 ** 3);
    expect(fromNoVol).toEqual({
      supported: false,
      maxBytes: 0,
      reason: EXPECTED_FAIL_CLOSED_REASON
    });
  });

  it('NukeOnDelete=1 và ổ rời exFAT đều trả supported: false; ổ NTFS hợp lệ trả supported: true', () => {
    const nuked = parseWindowsRecycleBinVolumeLine('3|NTFS|50000000000|500000000000|10240|1', 'E:', 50_000_000_000);
    expect(nuked.supported).toBe(false);
    expect(nuked.maxBytes).toBe(0);
    expect(nuked.reason).toContain('Xóa thẳng không qua Thùng rác');

    const removableExfat = parseWindowsRecycleBinVolumeLine('2|EXFAT|30000000000|64000000000|-1|0', 'F:', 30_000_000_000);
    expect(removableExfat.supported).toBe(false);
    expect(removableExfat.maxBytes).toBe(0);
    expect(removableExfat.reason).toContain('EXFAT');

    const validNtfsExplicit = parseWindowsRecycleBinVolumeLine(
      '3|NTFS|50000000000|500000000000|10240|0',
      'E:',
      50_000_000_000
    );
    expect(validNtfsExplicit.supported).toBe(true);
    expect(validNtfsExplicit.maxBytes).toBe(10240 * 1024 * 1024);

    const validNtfsDefaultPct = parseWindowsRecycleBinVolumeLine(
      '3|NTFS|50000000000|200000000000|-1|0',
      'E:',
      50_000_000_000
    );
    expect(validNtfsDefaultPct.supported).toBe(true);
    expect(validNtfsDefaultPct.maxBytes).toBe(10_000_000_000);
  });

  it.runIf(process.platform === 'win32')(
    'defaultReadRecycleBinCapacity gặp ổ không đọc được Win32_Volume (NO_VOL) phải dừng fail-closed thay vì mở 4 GiB',
    async () => {
      const missingFolder = findUnusedDriveRoot();
      if (!missingFolder) return;
      const cap = await defaultReadRecycleBinCapacity(missingFolder);
      expect(cap.supported).toBe(false);
      expect(cap.maxBytes).toBe(0);
      expect(cap.reason).toBe(EXPECTED_FAIL_CLOSED_REASON);
    }
  );
});
