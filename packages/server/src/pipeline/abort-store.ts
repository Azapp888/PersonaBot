/**
 * 「当前会话活跃 AbortController」注册表。
 *
 * 消息管道在处理某个 botId:userId 时注册其 AbortController，这样即使一次
 * LLM / 工具调用正在进行（无法从管道外部访问局部变量），新消息到达时也能
 * 中止在途请求，避免旧回复覆盖新回复、以及重复占用 token。
 */
const active = new Map<string, AbortController>();

export function registerAbort(key: string, controller: AbortController): void {
  active.set(key, controller);
}

/** 仅当注册的仍是同一个 controller 时清除，避免误删新一轮。 */
export function clearAbort(key: string, controller: AbortController): void {
  if (active.get(key) === controller) active.delete(key);
}

export function currentAbort(key: string): AbortController | undefined {
  return active.get(key);
}

/** 中止该会话在途请求（若存在）。返回是否确实中止了某个请求。 */
export function abortActive(key: string): boolean {
  const controller = active.get(key);
  if (!controller || controller.signal.aborted) return false;
  controller.abort();
  return true;
}
