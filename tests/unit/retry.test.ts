import { describe, expect, it } from 'vitest';
import { classifyFailure } from '@shared/utils/retry.js';
describe('retry classifier',()=>{it('retries temporary network failures',()=>expect(classifyFailure('HTTP Error 429 fragment timeout')).toBe('retryable'));it('does not retry private video',()=>expect(classifyFailure('Private video login required')).toBe('authentication'));it('stops on disk full',()=>expect(classifyFailure('No space left on device')).toBe('disk'))});
