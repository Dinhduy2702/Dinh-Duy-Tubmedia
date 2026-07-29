import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '@shared/utils/filename.js';
describe('filename sanitizer',()=>{it('removes windows invalid chars',()=>expect(sanitizeFilename('a<b>:c?.mp4')).toBe('a_b__c_.mp4'));it('protects reserved names',()=>expect(sanitizeFilename('CON')).toBe('_CON'))});
