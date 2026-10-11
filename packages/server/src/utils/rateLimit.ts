/**
 * 极简内存限流器：按 key（通常是 IP）统计时间窗口内的请求次数。
 *
 * 用于登录接口等敏感端点，抵御暴力破解。不引入外部依赖，
 * 定期清理过期条目以避免内存无限增长。
 */
export interface RateLimitOptions {
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大请求数 */
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly max: number;
  private lastSweep = 0;

  constructor(opts: RateLimitOptions) {
    this.windowMs = opts.windowMs;
    this.max = opts.max;
  }

  /** 记录一次请求。返回 true 表示允许，false 表示超限。 */
  hit(key: string, now = Date.now()): boolean {
    this.sweep(now);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.max;
  }

  /** 距离窗口重置的剩余毫秒数（用于 Retry-After）。 */
  retryAfterMs(key: string, now = Date.now()): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    return Math.max(0, bucket.resetAt - now);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) {
      if (b.resetAt <= now) this.buckets.delete(k);
    }
  }
}
