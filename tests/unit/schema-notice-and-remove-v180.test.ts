import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { settingsPatchSchema } from '../../src/shared/schemas/ipc.js';
import { noticeIssueKey } from '../../src/shared/utils/notice-issue.js';

const root = process.cwd();
const queueManager = readFileSync(join(root, 'src/main/queue/queue-manager.ts'), 'utf8');
const downloadEngine = readFileSync(join(root, 'src/main/downloader/download-engine.ts'), 'utf8');
const queuePage = readFileSync(join(root, 'src/renderer/src/pages/QueuePage.tsx'), 'utf8');

describe('#49 & #50: settingsPatchSchema.strip() + trim URL, tách khóa notice-issue, syncProjectStatus khi remove & wording CapCut 1 file', () => {
  it('#49: settingsPatchSchema bỏ qua trường lạ (.strip) và tự trim khoảng trắng quanh toolManifestUrl/appFeedUrl', () => {
    const parsed = settingsPatchSchema.parse({
      theme: 'dark',
      legacyRemovedField: 'should-be-stripped',
      toolManifestUrl: '  https://example.com/tools.json  ',
      appFeedUrl: '   '
    });
    expect(parsed.theme).toBe('dark');
    expect('legacyRemovedField' in parsed).toBe(false);
    expect(parsed.toolManifestUrl).toBe('https://example.com/tools.json');
    expect(parsed.appFeedUrl).toBe('');
  });

  it('#49: noticeIssueKey tách khóa cho tiêu đề chung chung và INVALID_INPUT theo message', () => {
    const a = noticeIssueKey({
      id: 'n1',
      severity: 'error',
      title: 'Không thể hoàn tất thao tác',
      message: 'Lỗi A'
    });
    const b = noticeIssueKey({
      id: 'n2',
      severity: 'error',
      title: 'Không thể hoàn tất thao tác',
      message: 'Lỗi B'
    });
    expect(a).not.toBe(b);

    const invA = noticeIssueKey({
      id: 'i1',
      severity: 'warning',
      code: 'INVALID_INPUT',
      title: 'Dữ liệu không hợp lệ',
      message: 'Mốc thời gian vượt giới hạn'
    });
    const invB = noticeIssueKey({
      id: 'i2',
      severity: 'warning',
      code: 'INVALID_INPUT',
      title: 'Dữ liệu không hợp lệ',
      message: 'Thư mục không hợp lệ'
    });
    expect(invA).not.toBe(invB);
  });

  it('#50: QueueManager.remove đồng bộ trạng thái project và QueuePage gọi refreshProjects', () => {
    const removeIdx = queueManager.indexOf('public async remove(');
    const nextMethodIdx = queueManager.indexOf('private async cleanupDeletedMergeProductFolder(', removeIdx);
    const removeBody = queueManager.slice(removeIdx, nextMethodIdx);
    expect(removeBody).toContain('this.syncProjectStatus(current.projectId)');
    expect(removeBody).toContain("this.projects.setStatus(current.projectId, 'draft')");

    expect(queuePage).toMatch(/removeSelected[\s\S]*refreshProjects\(\)/);
    expect(queuePage).toMatch(/removeOne[\s\S]*refreshProjects\(\)/);
  });

  it('#50: download-engine phân biệt chế độ 1 file CapCut trực tiếp với chế độ 2 file (edit copy)', () => {
    expect(downloadEngine).toContain('Đã tải và chuẩn hóa trực tiếp sang chuẩn CapCut');
    expect(downloadEngine).toContain('Đã giữ nguyên video master chất lượng cao và tạo riêng bản edit mượt cho CapCut');
  });
});
