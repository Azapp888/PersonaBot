import { conversationRepo } from "../db/repos/conversations";
import { contextRepo } from "../db/repos/context";
import { resolveProviderForPersona } from "../llm/factory";
import { contentToText } from "../llm/provider";
import { settingsService } from "../settings/service";
import { logger } from "../logger";
import type { ChatMessage, Persona } from "../types";
import { emptyState, updateState, renderState, type ConversationState } from "./state";

export interface BuiltContext {
  /** 最近 N 轮的原始对话（滑动窗口） */
  history: ChatMessage[];
  /** 更早对话的滚动摘要（含用户画像 / 当前状态 / 未完成任务 / 长期记忆点） */
  summary: string;
  /** 状态机结果 */
  state: ConversationState;
}

const SUMMARY_SYSTEM = `你是一个对话上下文压缩器。请把「已有摘要」与「新增的更早对话」合并成一份滚动摘要，供角色长期记住用户。

必须保留、不得丢失、不得与已知状态矛盾的内容：
1. 未完成任务状态（例如：作业未完成——物理、英语）；
2. 当前情绪与身体状态（例如：焦虑、极度疲惫、家人住院）；
3. 长期记忆点与约定（例如：约定周末爬山、纪念日、称呼）；
4. 稳定的用户画像（作息、偏好、忌讳）。

要求：
- 用第三人称、客观陈述，按「用户画像 / 当前状态 / 未完成任务 / 长期记忆点」分点组织；
- 合并重复信息，突出持续话题与关系变化；
- 不要编造不存在的内容；
- 只输出摘要正文（Markdown），控制在 500 字以内。`;

function transcript(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "用户" : m.role === "assistant" ? "角色" : m.role}: ${contentToText(m.content)}`)
    .join("\n");
}

async function summarize(
  persona: Persona,
  prevSummary: string,
  older: ChatMessage[],
  state: ConversationState,
): Promise<string> {
  const { provider } = resolveProviderForPersona(persona);
  const known = renderState(state);
  const userContent = [
    `【已有摘要】\n${prevSummary || "（无）"}`,
    known ? `【当前已知状态】\n${known}` : "",
    `【需要合并的更早对话】\n${transcript(older)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await provider.chat(
    [
      { role: "system", content: SUMMARY_SYSTEM },
      { role: "user", content: userContent },
    ],
    { temperature: 0.3, maxTokens: 1200 },
  );
  return result.content.trim();
}

/**
 * 组装一次对话的上下文：
 * 1. 用最新的用户输入更新状态机并持久化；
 * 2. 保留最近 N 轮原始对话（滑动窗口）；
 * 3. 超出窗口的更早对话触发滚动摘要，强制保留未完成任务 / 情绪 / 长期记忆点。
 */
export async function buildConversationContext(
  persona: Persona,
  userId: string,
  userText: string,
): Promise<BuiltContext> {
  const settings = settingsService.get();
  const conv = conversationRepo.ensure(persona.id, userId);
  const messages = conv.messages;
  const row = contextRepo.find(persona.id, userId);

  const state = updateState(row?.state ?? emptyState(), userText);
  contextRepo.saveState(persona.id, userId, state);

  let summary = row?.summary ?? "";
  let summarizedUpto = row?.summarizedUpto ?? 0;

  const rounds = Math.max(1, settings.contextRecentRounds);
  const keep = rounds * 2;

  if (!settings.contextSummaryEnabled || messages.length <= keep) {
    return { history: messages.slice(-keep), summary, state };
  }

  const olderEnd = messages.length - keep;
  const unsummarized = olderEnd - summarizedUpto;
  const step = Math.max(4, Math.floor(keep / 2));

  if (unsummarized >= step) {
    try {
      const next = await summarize(persona, summary, messages.slice(summarizedUpto, olderEnd), state);
      if (next) {
        summary = next;
        summarizedUpto = olderEnd;
        contextRepo.upsert({ personaId: persona.id, userId, summary, summarizedUpto, state });
        logger.debug({ personaId: persona.id, userId, length: next.length }, "context summarized");
      } else {
        logger.warn({ personaId: persona.id, userId }, "context summary returned empty, will retry next turn");
      }
    } catch (err) {
      logger.warn(
        { personaId: persona.id, userId, err: (err as Error).message },
        "context summarize failed, keep previous summary",
      );
    }
  }

  return { history: messages.slice(-keep), summary, state };
}

/** 仅供读取的当前状态（不做更新）。 */
export function getState(personaId: string, userId: string): ConversationState {
  return contextRepo.find(personaId, userId)?.state ?? emptyState();
}

export function getSummary(personaId: string, userId: string): string {
  return contextRepo.find(personaId, userId)?.summary ?? "";
}
