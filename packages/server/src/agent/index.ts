import type { ChatMessage, LLMUsage, ToolDefinition } from "../types";
import type { LLMProvider } from "../llm/provider";
import { runShellCommand, type ShellResult } from "./shell";

/** 暴露给模型的 shell 工具定义 */
export const SHELL_TOOL: ToolDefinition = {
  name: "run_shell",
  description:
    "在本机服务器上执行一条 shell 命令并返回其输出。可用于查询系统/文件信息、运行脚本、计算结果等。" +
    "命令有执行超时限制，输出过长会被截断；请一次只执行一条命令。",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的完整 shell 命令" },
    },
    required: ["command"],
  },
};

export interface ShellRunRecord {
  command: string;
  output: string;
  ok: boolean;
}

export interface AgentRunResult {
  content: string;
  usage: LLMUsage;
  toolRuns: ShellRunRecord[];
}

function emptyUsage(): LLMUsage {
  return { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
}

function addUsage(target: LLMUsage, add: LLMUsage): void {
  target.inputTokens += add.inputTokens;
  target.outputTokens += add.outputTokens;
  target.cacheHitTokens += add.cacheHitTokens;
  target.cacheMissTokens += add.cacheMissTokens;
}

/** 判断消息是否以 shell 触发前缀开头，返回待执行的命令。 */
export function detectShellCommand(text: string, prefix: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const prefixes = [prefix, "/shell", "!sh", "!shell"].filter(Boolean);
  for (const p of prefixes) {
    if (trimmed === p) return null;
    if (trimmed.startsWith(p + " ") || trimmed.startsWith(p + "　")) {
      const cmd = trimmed.slice(p.length).trim();
      return cmd || null;
    }
  }
  return null;
}

/** 将 shell 执行结果渲染为面向用户的回复文本。 */
export function formatShellReply(command: string, result: ShellResult): string {
  const head = `$ ${command}`;
  if (result.timedOut) {
    return `${head}\n[命令超时，已被终止]\n${result.output}`.trim();
  }
  const body = result.output || "(无输出)";
  const tail = result.ok ? "" : `\n[退出码 ${result.exitCode}]`;
  return `${head}\n${body}${tail}`;
}

/**
 * 带工具调用的 Agent 循环：模型可多次请求执行 shell，直到给出最终文本回复。
 * 仅在 provider 支持工具调用时使用。
 */
export async function runAgentLoop(
  provider: LLMProvider,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): Promise<AgentRunResult> {
  if (!provider.chatWithTools) throw new Error("provider does not support tools");
  const maxIterations = 5;
  const convo: ChatMessage[] = [...messages];
  const usage = emptyUsage();
  const toolRuns: ShellRunRecord[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const res = await provider.chatWithTools(convo, [SHELL_TOOL], options);
    addUsage(usage, res.usage);
    if (!res.toolCalls.length) {
      return { content: res.content, usage, toolRuns };
    }
    convo.push({ role: "assistant", content: res.content ?? "", toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      let command = "";
      try {
        command = String((JSON.parse(call.arguments || "{}") as any)?.command ?? "");
      } catch {
        command = "";
      }
      let output: string;
      let ok = false;
      if (!command.trim()) {
        output = "错误：工具调用未提供 command 参数";
      } else {
        const r = await runShellCommand(command);
        ok = r.ok;
        output = r.output || `(无输出，退出码 ${r.exitCode})`;
      }
      toolRuns.push({ command, output, ok });
      convo.push({ role: "tool", content: output, toolCallId: call.id });
    }
  }
  return { content: "", usage, toolRuns };
}
