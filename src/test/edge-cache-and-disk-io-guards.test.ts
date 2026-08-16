import { describe, expect, it } from 'vitest';
import { CACHE_HEADERS } from '@/worker/shared';

describe('Cloudflare Edge Caching & Disk IO Guards', () => {
  it('defines valid Cache-Control presets for static, frequent, and realtime endpoints', () => {
    expect(CACHE_HEADERS.STATIC['cache-control']).toContain('public');
    expect(CACHE_HEADERS.STATIC['cache-control']).toContain('s-maxage=300');
    expect(CACHE_HEADERS.STATIC['cache-control']).toContain('stale-while-revalidate=600');

    expect(CACHE_HEADERS.FREQUENT['cache-control']).toContain('public');
    expect(CACHE_HEADERS.FREQUENT['cache-control']).toContain('s-maxage=60');
    expect(CACHE_HEADERS.FREQUENT['cache-control']).toContain('stale-while-revalidate=120');

    expect(CACHE_HEADERS.REALTIME['cache-control']).toContain('public');
    expect(CACHE_HEADERS.REALTIME['cache-control']).toContain('s-maxage=3');
    expect(CACHE_HEADERS.REALTIME['cache-control']).toContain('stale-while-revalidate=10');

    expect(CACHE_HEADERS.PRIVATE_NO_CACHE['cache-control']).toContain('private');
    expect(CACHE_HEADERS.PRIVATE_NO_CACHE['cache-control']).toContain('no-store');
  });
});
