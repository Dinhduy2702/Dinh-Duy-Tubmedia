import { describe, expect, it } from 'vitest';
import { formatReleaseNotesForDisplay } from '../../src/shared/release-notes.js';

describe('update center release notes', () => {
  it('turns GitHub HTML into compact readable text', () => {
    const result = formatReleaseNotesForDisplay(
      '<h1>Download video Tubmedia 1.2.0</h1>' +
        '<h2>N\u1ed9i dung ch\u00ednh</h2>' +
        '<ul>' +
        '<li>C\u1ea3i thi\u1ec7n h\u00e0ng \u0111\u1ee3i.</li>' +
        '<li>Cookies t\u1ef1 ti\u1ebfp t\u1ee5c.</li>' +
        '</ul>' +
        '<h2>X\u00e1c minh b\u1ea3n ph\u00e1t h\u00e0nh</h2>' +
        '<p>Installer k\u1ef9 thu\u1eadt</p>'
    );

    expect(result).toContain('\u2022 C\u1ea3i thi\u1ec7n h\u00e0ng \u0111\u1ee3i.');
    expect(result).toContain('\u2022 Cookies t\u1ef1 ti\u1ebfp t\u1ee5c.');
    expect(result).not.toContain('<h1>');
    expect(result).not.toContain('Installer k\u1ef9 thu\u1eadt');
    expect(result).not.toContain('Download video Tubmedia 1.2.0');
    expect(result).not.toContain('N\u1ed9i dung ch\u00ednh');
    expect(result).not.toContain('X\u00e1c minh b\u1ea3n ph\u00e1t h\u00e0nh');
  });

  it('decodes safe HTML entities', () => {
    expect(formatReleaseNotesForDisplay('<p>A &amp; B&nbsp;C</p>')).toBe('A & B C');
  });
});
