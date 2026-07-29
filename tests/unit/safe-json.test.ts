import { describe, expect, it } from 'vitest';
import { parseJsonOr, parseJsonRecord, parseJsonStringArray } from '../../src/shared/utils/safe-json.js';

describe('safe JSON persistence decoding', () => {
  it('falls back instead of crashing bootstrap on malformed JSON', () => {
    expect(parseJsonOr('{broken', { safe: true })).toEqual({ safe: true });
    expect(parseJsonRecord('{broken')).toEqual({ dataCorrupted: true });
    expect(parseJsonStringArray('["ok",1,null]')).toEqual(['ok']);
  });
});
