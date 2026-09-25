import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadMergeDraftSchema, downloadMergeSchema } from '../../src/shared/schemas/ipc.js';

async function pageSource(): Promise<string> {
  return readFile(join(process.cwd(), 'src/renderer/src/pages/DownloadMergePage.tsx'), 'utf8');
}

function constantOf(source: string, name: string): number {
  const match = new RegExp(`const ${name} = (\\d+);`).exec(source);
  expect(match, `thiếu hằng ${name}`).not.toBeNull();
  return Number(match![1]);
}

const base = {
  slot: 'merge-1' as const,
  linksText: 'https://example.com/a.mp4',
  sourceFolder: 'D:\\nguon',
  tempFolder: 'D:\\tam',
  outputFolder: 'D:\\ra',
  qualityProfileId: 'quality-smart-merge',
  resourceProfileId: 'resource-balanced',
  exportTimelineTxt: false
};

describe('Tên sản phẩm đầu ra của Tải & Ghép: giới hạn giao diện khớp schema IPC', () => {
  it('hằng số trên giao diện đúng bằng giới hạn của schema (name 160, finalFileName 220)', async () => {
    const source = await pageSource();
    const nameMax = constantOf(source, 'MERGE_LANE_NAME_MAX_LENGTH');
    const fileMax = constantOf(source, 'MERGE_FINAL_FILE_NAME_MAX_LENGTH');

    const payload = (name: string, finalFileName: string) => ({ ...base, name, finalFileName });
    expect(downloadMergeSchema.safeParse(payload('n'.repeat(nameMax), 'f'.repeat(fileMax))).success).toBe(true);
    expect(downloadMergeSchema.safeParse(payload('n'.repeat(nameMax + 1), 'f')).success).toBe(false);
    expect(downloadMergeSchema.safeParse(payload('n', 'f'.repeat(fileMax + 1))).success).toBe(false);
    expect(downloadMergeDraftSchema.safeParse(payload('n'.repeat(nameMax + 1), 'f')).success).toBe(false);
  });

  it('tên dài 161–220 ký tự vẫn gửi được: name bị cắt còn 160, finalFileName giữ nguyên', async () => {
    const source = await pageSource();
    const nameMax = constantOf(source, 'MERGE_LANE_NAME_MAX_LENGTH');
    const fileMax = constantOf(source, 'MERGE_FINAL_FILE_NAME_MAX_LENGTH');
    const typed = 'Tên rất dài '.repeat(20).slice(0, fileMax);

    // giống hệt biểu thức trong start() và bản nháp tự lưu
    const sent = { ...base, name: typed.slice(0, nameMax), finalFileName: typed };
    expect(typed.length).toBe(fileMax);
    expect(downloadMergeSchema.safeParse(sent).success).toBe(true);
    expect(downloadMergeDraftSchema.safeParse(sent).success).toBe(true);
  });

  it('cả hai lần gửi (bắt đầu và lưu nháp) đều cắt name, và ô nhập bị giới hạn 220 ký tự', async () => {
    const source = await pageSource();
    expect(source.match(/name: forms\[slot\]\.finalFileName\.slice\(0, MERGE_LANE_NAME_MAX_LENGTH\),/g)).toHaveLength(2);
    expect(source).not.toMatch(/name: forms\[slot\]\.finalFileName,/);
    expect(source).toContain('maxLength={MERGE_FINAL_FILE_NAME_MAX_LENGTH}');
  });
});
