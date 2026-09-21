import { describe, expect, it } from 'vitest';
import { isBlockedOpenPath } from '../../src/main/security/open-path-policy.js';

describe('isBlockedOpenPath', () => {
  it.each([
    'C:\\Users\\Hi\\Downloads\\setup.exe',
    'D:\\tools\\run.BAT',
    'C:\\x\\script.ps1',
    'C:\\x\\evil.exe.',
    'C:\\x\\evil.cmd ',
    'C:\\x\\shortcut.lnk'
  ])('chặn %s', (path) => {
    expect(isBlockedOpenPath(path)).toBe(true);
  });

  it.each([
    'C:\\Users\\Hi\\Videos',
    'D:\\Video\\Tiêu đề [abc123].mp4',
    'D:\\Video\\timeline.txt',
    'D:\\Video\\cover.png',
    'D:\\Video\\folder.with.dots'
  ])('cho phép %s', (path) => {
    expect(isBlockedOpenPath(path)).toBe(false);
  });
});
