export interface RetryOptions {
  attempts: number;
  /** Per-try timeout, enforced with AbortSignal.timeout. */
  timeoutMs: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /** Return false for errors that will not get better by retrying (e.g. 400). */
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class RetryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(
      `gave up after ${attempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs fn with a per-try timeout and exponential backoff with full jitter.
 * Throws RetryExhaustedError when attempts are used up; callers convert that to an
 * explicit "unavailable" result rather than letting it reach the business flow.
 */
export async function retry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const maxDelay = opts.maxDelayMs ?? 5_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn(AbortSignal.timeout(opts.timeoutMs));
    } catch (err) {
      lastError = err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) break;
      if (attempt === opts.attempts) break;
      const cap = Math.min(maxDelay, opts.baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.round(cap / 2 + (random() * cap) / 2);
      opts.onRetry?.(attempt, err, delay);
      await sleep(delay);
    }
  }
  throw new RetryExhaustedError(opts.attempts, lastError);
}
