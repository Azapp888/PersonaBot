import type { ChatMessage, LLMChatOptions, LLMUsage, ToolDefinition } from "../types";
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

/** 一个可由模型调用的工具及其执行器。 */
export interface AgentTool {
  definition: ToolDefinition;
  execute: (args: any, signal?: AbortSignal) => Promise<{ output: string; ok: boolean }>;
}

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

export interface ToolRunRecord {
  name: string;
  args: Record<string, unknown>;
  output: string;
  ok: boolean;
}

export interface ToolLoopResult {
  content: string;
  usage: LLMUsage;
  toolRuns: ToolRunRecord[];
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
 * 通用工具调用循环：模型可以多次调用任意已注册工具，直到给出最终文本回复。
 * 工具输出会回填到对话中，并在回填前截断，避免上下文与 token 失控。
 */
export async function runToolLoop(
  provider: LLMProvider,
  messages: ChatMessage[],
  tools: AgentTool[],
  options: LLMChatOptions & { maxIterations?: number } = {},
): Promise<ToolLoopResult> {
  if (!provider.chatWithTools) throw new Error("provider does not support tools");
  if (!tools.length) throw new Error("no tools registered");
  const maxIterations = options.maxIterations ?? 5;
  const byName = new Map(tools.map((t) => [t.definition.name, t]));
  const convo: ChatMessage[] = [...messages];
  const usage = emptyUsage();
  const toolRuns: ToolRunRecord[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const res = await provider.chatWithTools(
      convo,
      tools.map((t) => t.definition),
      { temperature: options.temperature, maxTokens: options.maxTokens, signal: options.signal, thinking: options.thinking },
    );
    addUsage(usage, res.usage);
    if (!res.toolCalls.length) {
      return { content: res.content, usage, toolRuns };
    }
    convo.push({ role: "assistant", content: res.content ?? "", toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      if (options.signal?.aborted) {
        return { content: "", usage, toolRuns };
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        args = {};
      }
      let output: string;
      let ok = false;
      const tool = byName.get(call.name);
      if (!tool) {
        output = `错误：未知工具 ${call.name}`;
      } else {
        try {
          const r = await tool.execute(args, options.signal);
          ok = r.ok;
          output = r.output || "(无输出)";
        } catch (err) {
          output = `工具执行失败：${(err as Error).message}`;
        }
      }
      if (output.length > 6000) output = output.slice(0, 6000) + "\n…（已截断）";
      toolRuns.push({ name: call.name, args, output, ok });
      convo.push({ role: "tool", content: output, toolCallId: call.id });
    }
  }
  return { content: "", usage, toolRuns };
}

/** 内置 shell 工具。 */
export const SHELL_AGENT_TOOL: AgentTool = {
  definition: SHELL_TOOL,
  execute: async (args) => {
    const command = String((args as any)?.command ?? "").trim();
    if (!command) return { output: "错误：工具调用未提供 command 参数", ok: false };
    const r = await runShellCommand(command);
    return { output: r.output || `(无输出，退出码 ${r.exitCode})`, ok: r.ok };
  },
};

/**
 * 带工具调用的 Agent 循环：模型可多次请求执行 shell，直到给出最终文本回复。
 * 仅在 provider 支持工具调用时使用。
 */
export async function runAgentLoop(
  provider: LLMProvider,
  messages: ChatMessage[],
  options: LLMChatOptions & { extraTools?: AgentTool[] } = {},
): Promise<AgentRunResult> {
  const res = await runToolLoop(provider, messages, [SHELL_AGENT_TOOL, ...(options.extraTools ?? [])], options);
  return {
    content: res.content,
    usage: res.usage,
    toolRuns: res.toolRuns
      .filter((r) => r.name === SHELL_TOOL.name)
      .map((r) => ({
        command: String((r.args as any)?.command ?? ""),
        output: r.output,
        ok: r.ok,
      })),
  };
}
