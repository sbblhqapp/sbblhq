import { describe, it, expect, beforeEach } from 'vitest';
import * as RateLimiter from '../rate-limit';

describe('enforceInMemoryRateLimit', () => {
  beforeEach(() => {
    RateLimiter.runtimeRateLimit.clear();
  });

  it('allows requests within the limit', () => {
    const key = 'user1';
    const limit = 5;
    const windowMs = 1000;

    for (let i = 0; i < limit; i++) {
      expect(RateLimiter.enforceInMemoryRateLimit(key, limit, windowMs)).toBe(true);
    }
  });

  it('blocks requests exceeding the limit', () => {
    const key = 'user1';
    const limit = 5;
    const windowMs = 1000;

    for (let i = 0; i < limit; i++) {
      RateLimiter.enforceInMemoryRateLimit(key, limit, windowMs);
    }
    expect(RateLimiter.enforceInMemoryRateLimit(key, limit, windowMs)).toBe(false);
  });

  it('evicts entries when reaching the max size', () => {
    const smallMax = 3;

    RateLimiter.enforceInMemoryRateLimit('key1', 5, 1000, smallMax); // size 1
    RateLimiter.enforceInMemoryRateLimit('key2', 5, 1000, smallMax); // size 2
    RateLimiter.enforceInMemoryRateLimit('key3', 5, 1000, smallMax); // size 3

    expect(RateLimiter.runtimeRateLimit.size).toBe(3);
    expect(RateLimiter.runtimeRateLimit.has('key1')).toBe(true);

    // This should trigger batch eviction (500 in prod, but here it will evict all up to 500)
    RateLimiter.enforceInMemoryRateLimit('key4', 5, 1000, smallMax);

    // It should have evicted all 3 existing keys and added key4
    expect(RateLimiter.runtimeRateLimit.size).toBe(1);
    expect(RateLimiter.runtimeRateLimit.has('key1')).toBe(false);
    expect(RateLimiter.runtimeRateLimit.has('key2')).toBe(false);
    expect(RateLimiter.runtimeRateLimit.has('key3')).toBe(false);
    expect(RateLimiter.runtimeRateLimit.has('key4')).toBe(true);
  });
});
