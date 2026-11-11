import { describe, expect, it } from 'vitest';
import { price } from '../components/format';

describe('prices', () => {
  it('reads like Hyperliquid at every scale, and a sub-cent coin never shows as 0.00', () => {
    expect(price(74_492.4)).toBe('74,492');
    expect(price(2_088.5)).toBe('2,088.50');
    expect(price(1.0712)).toBe('1.07');
    expect(price(0.97006)).toBe('0.97006');
    expect(price(0.0331294998)).toBe('0.033129');
    expect(price(0.0051740659)).toBe('0.005174');
  });
});
