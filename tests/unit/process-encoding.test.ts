import { describe, expect, it } from 'vitest';
import { processEnvironmentFor } from '../../src/main/processes/process-manager.js';
import {
  cleanExternalText,
  containsUnicodeReplacement
} from '../../src/shared/utils/text-encoding.js';

describe('external process text encoding', () => {
  it('forces UTF-8 for every yt-dlp child process without dropping inherited variables', () => {
    expect(
      processEnvironmentFor('yt-dlp', { CUSTOM_SETTING: 'kept' }, { PATH: 'C:\\Tools' })
    ).toMatchObject({
      PATH: 'C:\\Tools',
      CUSTOM_SETTING: 'kept',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1'
    });
  });

  it('does not persist strings that already contain Unicode replacement characters', () => {
    expect(containsUnicodeReplacement('T\uFFFDm Em')).toBe(true);
    expect(cleanExternalText('  Tìm Em, Không Buông  ')).toBe('Tìm Em, Không Buông');
    expect(cleanExternalText('T\uFFFDm Em')).toBeNull();
  });
});
