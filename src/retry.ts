// How many times one request is made in all, the first attempt included.
export const MAX_RATE_LIMIT_ATTEMPTS = 3;

// The wait before the second attempt when the server gave no Retry-After. It
// doubles for each attempt after that.
const BASE_DELAY_MS = 1_000;

// The longest wait that is worth holding a request for. An upload holds one of
// the concurrency slots, and the catalog waits for the upload, so a wait longer
// than this stalls catalog processing. A server that asks for longer is better
// answered by giving up: the entity is not cached, so the next cycle tries again.
export const MAX_RETRY_DELAY_MS = 10_000;

export type RetryOptions = {
  /** Called before each wait, for logging and metrics. */
  onRetry?: (retry: { attempt: number; delayMs: number }) => void;
  /** How to wait. Replaceable so tests do not have to. */
  sleep?: (ms: number) => Promise<void>;
  /** A number in [0, 1), the source of the jitter. Replaceable for tests. */
  random?: () => number;
  /** The current time in ms, used to read an HTTP-date Retry-After. */
  now?: () => number;
};

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * retryAfterMs reads how long the server asked a rate-limited client to wait.
 * Retry-After is either a number of seconds or an HTTP date (RFC 9110, 10.2.3).
 * @param err - The error a rate-limited request rejected with
 * @param now - The current time in ms
 * @returns - The wait in ms, or undefined if the header is absent or unreadable
 */
export function retryAfterMs(
  err: unknown,
  now: number = Date.now(),
): number | undefined {
  const headers = (err as { headers?: Record<string, unknown> } | undefined)
    ?.headers;
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  // Header names are case-insensitive, and clients differ on how they spell them
  const name = Object.keys(headers).find(
    k => k.toLowerCase() === 'retry-after',
  );
  const value = name === undefined ? undefined : headers[name];
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * withRateLimitRetry runs a request and, if the API answers 429 Too Many
 * Requests, runs it again after the wait the server asked for. A 429 means the
 * request was refused before it did anything, so repeating it is safe whatever
 * the request was.
 *
 * It gives up, rethrowing the 429, after MAX_RATE_LIMIT_ATTEMPTS attempts, or at
 * once if the server asks for a wait longer than MAX_RETRY_DELAY_MS. Any other
 * error is rethrown straight away: only a rate limit is worth waiting out.
 * @param request - Makes one attempt
 * @param options - Hooks for logging and for tests
 * @returns - What the request resolves to
 */
export async function withRateLimitRetry<T>(
  request: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const wait = options.sleep ?? sleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  for (let attempt = 1; ; attempt++) {
    try {
      return await request();
    } catch (err: any) {
      if (err?.code !== 429 || attempt >= MAX_RATE_LIMIT_ATTEMPTS) {
        throw err;
      }

      const asked = retryAfterMs(err, now());
      // Without a Retry-After, back off exponentially. Jitter keeps the entities
      // that were refused together from all coming back together.
      const delayMs =
        asked ?? BASE_DELAY_MS * 2 ** (attempt - 1) * (0.75 + random() * 0.5);
      if (delayMs > MAX_RETRY_DELAY_MS) {
        throw err;
      }

      options.onRetry?.({ attempt, delayMs });
      await wait(delayMs);
    }
  }
}
