import { describe, expect, it } from 'vitest';
import { effectiveMemoryReserveBytes } from '../../src/shared/utils/resource-memory.js';

const GIB = 1024 ** 3;

describe('adaptive memory reserve', () => {
  it('prevents a fixed profile reserve from starving a typical user machine', () => {
    expect(effectiveMemoryReserveBytes(6 * GIB, 8 * GIB)).toBe(Math.floor(8 * GIB * 0.15));
    expect(effectiveMemoryReserveBytes(8 * GIB, 16 * GIB)).toBe(Math.floor(16 * GIB * 0.15));
  });

  it('preserves a smaller user-configured reserve', () => {
    expect(effectiveMemoryReserveBytes(1 * GIB, 32 * GIB)).toBe(1 * GIB);
  });

  it('uses a conservative floor on low-memory machines', () => {
    expect(effectiveMemoryReserveBytes(4 * GIB, 4 * GIB)).toBe(768 * 1024 ** 2);
  });

  it('falls back to the configured value when total memory is unavailable', () => {
    expect(effectiveMemoryReserveBytes(2 * GIB, 0)).toBe(2 * GIB);
  });
});
