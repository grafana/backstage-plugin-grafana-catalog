import {
  MAX_RATE_LIMIT_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  retryAfterMs,
  withRateLimitRetry,
} from './retry';

const status = (code: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${code}`), { code, headers });

describe('retryAfterMs', () => {
  it('reads a number of seconds', () => {
    expect(retryAfterMs(status(429, { 'retry-after': '7' }))).toBe(7000);
    expect(retryAfterMs(status(429, { 'retry-after': '0' }))).toBe(0);
  });

  it('reads an HTTP date, relative to now', () => {
    const now = Date.parse('2026-11-07T10:00:00Z');
    const err = status(429, { 'retry-after': 'Sat, 07 Nov 2026 10:00:05 GMT' });

    expect(retryAfterMs(err, now)).toBe(5000);
  });

  it('treats a date that has already passed as no wait', () => {
    const now = Date.parse('2026-11-07T10:00:00Z');
    const err = status(429, { 'retry-after': 'Sat, 07 Nov 2026 09:00:00 GMT' });

    expect(retryAfterMs(err, now)).toBe(0);
  });

  it('finds the header whatever its case', () => {
    expect(retryAfterMs(status(429, { 'Retry-After': '3' }))).toBe(3000);
    expect(retryAfterMs(status(429, { 'RETRY-AFTER': '3' }))).toBe(3000);
  });

  it('copes with a missing, empty or unreadable header', () => {
    expect(retryAfterMs(status(429))).toBeUndefined();
    expect(retryAfterMs(status(429, { 'retry-after': '' }))).toBeUndefined();
    expect(
      retryAfterMs(status(429, { 'retry-after': 'soon' })),
    ).toBeUndefined();
    expect(retryAfterMs(new Error('no headers at all'))).toBeUndefined();
    expect(retryAfterMs(undefined)).toBeUndefined();
    expect(retryAfterMs(null)).toBeUndefined();
  });
});

describe('withRateLimitRetry', () => {
  const sleep = jest.fn().mockResolvedValue(undefined);
  // Jitter of exactly 1: 0.75 + 0.5 * 0.5
  const random = () => 0.5;

  beforeEach(() => {
    sleep.mockClear();
  });

  it('returns the result of a request that works, without waiting', async () => {
    const request = jest.fn().mockResolvedValue('ok');

    await expect(withRateLimitRetry(request, { sleep })).resolves.toBe('ok');

    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('tries again after a 429 and returns the result', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(status(429))
      .mockResolvedValue('ok');

    await expect(withRateLimitRetry(request, { sleep, random })).resolves.toBe(
      'ok',
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('waits as long as Retry-After asks', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(status(429, { 'retry-after': '4' }))
      .mockResolvedValue('ok');

    await withRateLimitRetry(request, { sleep, random });

    expect(sleep).toHaveBeenCalledWith(4000);
  });

  it('backs off exponentially when there is no Retry-After', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(status(429))
      .mockRejectedValueOnce(status(429))
      .mockResolvedValue('ok');

    await withRateLimitRetry(request, { sleep, random });

    expect(sleep.mock.calls.map(c => c[0])).toEqual([1000, 2000]);
  });

  it('spreads the wait with jitter', async () => {
    const waits = async (r: number) => {
      sleep.mockClear();
      await withRateLimitRetry(
        jest.fn().mockRejectedValueOnce(status(429)).mockResolvedValue('ok'),
        { sleep, random: () => r },
      );
      return sleep.mock.calls[0][0];
    };

    expect(await waits(0)).toBe(750);
    expect(await waits(0.999)).toBeCloseTo(1250, -1);
  });

  it('gives up after the allowed attempts and rethrows the 429', async () => {
    const error = status(429);
    const request = jest.fn().mockRejectedValue(error);

    await expect(withRateLimitRetry(request, { sleep, random })).rejects.toBe(
      error,
    );

    expect(request).toHaveBeenCalledTimes(MAX_RATE_LIMIT_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(MAX_RATE_LIMIT_ATTEMPTS - 1);
  });

  it('gives up at once when asked to wait longer than it is worth', async () => {
    const error = status(429, {
      'retry-after': String(MAX_RETRY_DELAY_MS / 1000 + 1),
    });
    const request = jest.fn().mockRejectedValue(error);

    await expect(withRateLimitRetry(request, { sleep, random })).rejects.toBe(
      error,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('still waits for exactly the longest wait it allows', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(
        status(429, { 'retry-after': String(MAX_RETRY_DELAY_MS / 1000) }),
      )
      .mockResolvedValue('ok');

    await withRateLimitRetry(request, { sleep, random });

    expect(sleep).toHaveBeenCalledWith(MAX_RETRY_DELAY_MS);
  });

  it.each([
    ['a 500', status(500)],
    ['a 404', status(404)],
    ['a 401', status(401)],
    [
      'a refused connection',
      Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
    ],
    ['an error with no code', new Error('boom')],
  ])('does not retry %s', async (_name, error) => {
    const request = jest.fn().mockRejectedValue(error);

    await expect(withRateLimitRetry(request, { sleep })).rejects.toBe(error);

    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('tells the caller about each retry', async () => {
    const onRetry = jest.fn();
    const request = jest
      .fn()
      .mockRejectedValueOnce(status(429, { 'retry-after': '1' }))
      .mockRejectedValueOnce(status(429, { 'retry-after': '2' }))
      .mockResolvedValue('ok');

    await withRateLimitRetry(request, { sleep, onRetry });

    expect(onRetry.mock.calls.map(c => c[0])).toEqual([
      { attempt: 1, delayMs: 1000 },
      { attempt: 2, delayMs: 2000 },
    ]);
  });

  it('does not tell the caller about the attempt it gives up on', async () => {
    const onRetry = jest.fn();
    const request = jest.fn().mockRejectedValue(status(429));

    await withRateLimitRetry(request, { sleep, random, onRetry }).catch(
      () => undefined,
    );

    expect(onRetry).toHaveBeenCalledTimes(MAX_RATE_LIMIT_ATTEMPTS - 1);
  });
});
