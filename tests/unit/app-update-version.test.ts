import { describe, expect, it } from 'vitest';
import { compareAppVersions, isNewerAppVersion } from '../../src/shared/app-version.js';

describe('app update semantic version safety', () => {
  it('recognizes a real upgrade', () => {
    expect(compareAppVersions('1.3.1', '1.3.0')).toBe(1);
    expect(isNewerAppVersion('1.3.1', '1.3.0')).toBe(true);
  });

  it('blocks downgrade from 1.3.0 to 1.2.8', () => {
    expect(compareAppVersions('1.2.8', '1.3.0')).toBe(-1);
    expect(isNewerAppVersion('1.2.8', '1.3.0')).toBe(false);
  });

  it('treats equal versions as current', () => {
    expect(compareAppVersions('1.3.0', '1.3.0')).toBe(0);
    expect(isNewerAppVersion('1.3.0', '1.3.0')).toBe(false);
  });

  it('treats prerelease as older than stable', () => {
    expect(compareAppVersions('1.3.0-beta.2', '1.3.0')).toBe(-1);
    expect(compareAppVersions('1.3.0', '1.3.0-beta.2')).toBe(1);
  });

  it('accepts v prefix and build metadata', () => {
    expect(compareAppVersions('v1.3.1+build.5', '1.3.0+local.2')).toBe(1);
  });

  it('fails closed for invalid versions', () => {
    expect(compareAppVersions('latest', '1.3.0')).toBeNull();
    expect(isNewerAppVersion('latest', '1.3.0')).toBe(false);
  });
});
