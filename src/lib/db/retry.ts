const RETRYABLE = new Set([
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
]);

function isRetryable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    RETRYABLE.has((err as { name?: string }).name ?? "")
  );
}

/**
 * Retries a DynamoDB call up to maxAttempts times on transient throttle errors.
 *
 * Uses exponential backoff with full jitter so concurrent retries from
 * multiple requests don't all fire at the same moment:
 *   delay = random(0, baseMs * 2^attempt)
 *   attempt 1: 0–100 ms, attempt 2: 0–200 ms, then throws.
 *
 * Non-retryable errors are re-thrown immediately on the first failure.
 * The original AWS error (including $metadata / requestId) is preserved.
 *
 * @example
 *   const result = await withDdbRetry(() => ddb.send(new QueryCommand({ ... })));
 */
export async function withDdbRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseMs = 100,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      lastErr = err;

      if (attempt < maxAttempts - 1) {
        const ceiling = baseMs * Math.pow(2, attempt);
        await new Promise((res) => setTimeout(res, Math.random() * ceiling));
      }
    }
  }

  throw lastErr;
}
