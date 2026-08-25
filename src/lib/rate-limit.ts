// Simple in-memory sliding-window rate limiter for inbound integration
// endpoints. Per-process only — swap for Redis/upstash when running more
// than one instance.

const globalForRateLimit = globalThis as unknown as {
  rateLimitBuckets?: Map<string, number[]>;
};
const buckets = (globalForRateLimit.rateLimitBuckets ??= new Map<string, number[]>());

export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const windowStart = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)),
    };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, retryAfterSeconds: 0 };
}
