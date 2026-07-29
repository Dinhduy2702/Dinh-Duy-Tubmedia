import { describe, expect, it } from 'vitest';
import { defaultAppSettings } from '../../src/main/settings/defaults.js';

describe('fast download defaults', () => {
  it('matches the proven parallel downloader tuning', () => {
    expect(defaultAppSettings.useAria2c).toBe(true);
    expect(defaultAppSettings.aria2Connections).toBe(16);
    expect(defaultAppSettings.downloadConcurrentFragments).toBe(2);
    expect(defaultAppSettings.progressRefreshMs).toBe(300);
  });

  it('uses standard verification by default instead of decoding every frame', () => {
    expect(defaultAppSettings.verificationLevel).toBe('standard');
    expect(defaultAppSettings.downloadVerifyEntireFile).toBe(false);
  });
});
