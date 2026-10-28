/**
 * 轻量熔断器：按模型维度统计连续失败次数，超过阈值后在冷却窗口内跳过该模型，
 * 避免上游持续故障时每条消息都先打满超时再失败（放大 P95 延迟）。
 *
 * 纯内存实现，进程重启即清空；不改变任何持久化数据，回滚只需删除本文件与调用点。
 */
export interface CircuitState {
  failures: number;
  openUntil: number;
}

const FAILURE_THRESHOLD = Number(process.env.LLM_CIRCUIT_FAILURES ?? 3);
const COOLDOWN_MS = Number(process.env.LLM_CIRCUIT_COOLDOWN_MS ?? 60_000);

const states = new Map<string, CircuitState>();

export const circuitBreaker = {
  isOpen(modelId: string | null | undefined, now = Date.now()): boolean {
    if (!modelId) return false;
    const state = states.get(modelId);
    if (!state) return false;
    if (state.openUntil === 0) return false;
    if (state.openUntil <= now) {
      states.delete(modelId);
      return false;
    }
    return true;
  },
  recordSuccess(modelId: string | null | undefined): void {
    if (!modelId) return;
    states.delete(modelId);
  },
  recordFailure(modelId: string | null | undefined, now = Date.now()): void {
    if (!modelId) return;
    const state = states.get(modelId) ?? { failures: 0, openUntil: 0 };
    state.failures += 1;
    if (state.failures >= FAILURE_THRESHOLD) {
      state.openUntil = now + COOLDOWN_MS;
      state.failures = 0;
    }
    states.set(modelId, state);
  },
  /** 测试用：清空全部状态。 */
  reset(): void {
    states.clear();
  },
};
