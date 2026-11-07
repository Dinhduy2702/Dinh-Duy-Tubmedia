import { describe, expect, it } from 'vitest';
import {
  CAPCUT_MODE_SETTING_KEYS,
  highestSourcePatch,
  light720Patch,
  machineRecommendationPatch,
  reference1080Patch
} from '../../src/shared/utils/download-presets.js';

// 1.7.6 việc E: không nút mẫu nào được đổi chế độ CapCut ("CapCut trực tiếp" / "tạo thêm bản CapCut").
describe('Mẫu cài đặt tải danh sách không đổi chế độ CapCut', () => {
  const presets = {
    'Theo máy': machineRecommendationPatch('resource-auto-1'),
    'Chuẩn 1080p': reference1080Patch(),
    'Nguồn cao nhất': highestSourcePatch(),
    '720p nhẹ': light720Patch()
  };

  for (const [name, values] of Object.entries(presets)) {
    it(`${name}: không chứa khoá chế độ CapCut`, () => {
      for (const key of CAPCUT_MODE_SETTING_KEYS) expect(Object.keys(values)).not.toContain(key);
    });
  }

  it('"Theo máy" chỉ chỉnh tốc độ: hồ sơ tài nguyên + số mảnh tự dò, không đụng chất lượng', () => {
    expect(machineRecommendationPatch('resource-auto-1')).toEqual({
      defaultResourceProfileId: 'resource-auto-1',
      downloadFragmentsAuto: true
    });
  });

  it('các mẫu chất lượng giữ đúng giá trị cũ (chỉ bỏ khoá chế độ)', () => {
    expect(reference1080Patch()).toMatchObject({ downloadMinHeight: 720, downloadMaxHeight: 1080, downloadCodecPreference: 'h264' });
    expect(highestSourcePatch()).toMatchObject({ downloadMaxHeight: 0, downloadCodecPreference: 'auto', downloadAllowBelowMinimum: false });
    expect(light720Patch()).toMatchObject({ downloadMaxHeight: 720, downloadMaxFps: 30, downloadContainerPreference: 'mp4' });
  });
});
