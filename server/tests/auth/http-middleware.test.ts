import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../../src/auth/http-middleware';

function response() {
  const result = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
  result.status.mockReturnValue(result);
  return result;
}

function request(ip: string): Request { return { ip } as Request; }

describe('HTTP rate limit boundaries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('allows the threshold, rejects the next request and expires precisely at the window', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const limiter = createRateLimiter(2, 1500, 'test');
    const next = vi.fn();
    const reply = response();
    for (let index = 0; index < 2; index++) limiter(request('one'), reply as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
    limiter(request('one'), reply as unknown as Response, next);
    expect(reply.status).toHaveBeenCalledWith(429);
    expect(reply.setHeader).toHaveBeenLastCalledWith('Retry-After', 2);
    now.mockReturnValue(2499);
    limiter(request('one'), reply as unknown as Response, next);
    expect(reply.setHeader).toHaveBeenLastCalledWith('Retry-After', 1);
    expect(next).toHaveBeenCalledTimes(2);
    now.mockReturnValue(2500);
    limiter(request('one'), reply as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('bounds active IP buckets and reclaims expired capacity', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const limiter = createRateLimiter(2, 1000);
    const next = vi.fn();
    const reply = response();
    for (let index = 0; index < 10000; index++) limiter(request(`ip-${index}`), reply as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(10000);
    limiter(request('overflow'), reply as unknown as Response, next);
    expect(reply.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(10000);
    limiter(request('ip-0'), reply as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(10001);
    now.mockReturnValue(2000);
    limiter(request('overflow'), reply as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(10002);
  });
});
