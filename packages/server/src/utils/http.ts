/**
 * 带超时的 fetch 封装。
 *
 * 项目中所有对外网络请求（QQ OpenAPI、LLM Provider、GitHub、绘画、附件下载）
 * 都应设置超时，避免上游长时间无响应导致请求 / 定时任务被永久挂起、连接与内存泄漏。
 *
 * 若调用方已通过 options.signal 传入外部信号（如消息打断），会将其与超时信号合并：
 * 任一方触发都会中止请求。
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30000, signal: external, ...rest } = init;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(new Error("request timeout")), timeoutMs);

  let signal = timeoutController.signal;
  if (external) {
    if (typeof AbortSignal !== "undefined" && "any" in AbortSignal) {
      signal = (AbortSignal as any).any([external, timeoutController.signal]);
    } else if (external.aborted) {
      timeoutController.abort((external as any).reason);
    } else {
      external.addEventListener("abort", () => timeoutController.abort((external as any).reason), { once: true });
    }
  }

  try {
    return await fetch(input, { ...rest, signal });
  } finally {
    clearTimeout(timer);
  }
}
