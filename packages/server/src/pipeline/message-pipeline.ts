import { botRepo } from "../db/repos/bots";
import { personaRepo } from "../db/repos/personas";
import { conversationRepo } from "../db/repos/conversations";
import { profileRepo } from "../db/repos/profiles";
import { logRepo } from "../db/repos/logs";
import { statsRepo } from "../db/repos/stats";
import { resolveProviderForPersona } from "../llm/factory";
import { assembleSystemPrompt } from "../persona/prompt";
import { buildMemoryInjection, syncMemoryFiles } from "../memory/service";
import { extractUserHabits } from "../memory/profile";
import { generatePainting, canPaint, type PaintingResult } from "../painting/service";
import { notifyUserReplied } from "../proactive/service";
import { QQApiClient } from "../qq/client";
import { settingsService } from "../settings/service";
import { logger } from "../logger";
import type { Bot, ChatMessage, LLMUsage, Persona, QQMessageEvent } from "../types";
import { formatDate, sleep } from "../utils/id";
import { splitReply } from "../utils/text";

const PAINT_KEYWORDS = ["画一张", "画个", "画幅", "画画", "画一下", "帮我画", "给我画", "作画", "绘一张", "来张图"];

export interface GenerateResult {
  reply: string;
  usage: LLMUsage;
  modelId: string | null;
  painting?: PaintingResult;
}

function applyCommands(persona: Persona, text: string): string {
  if (!persona.commands?.length) return text;
  const trimmed = text.trim();
  const matched = persona.commands.find((c) => c.trigger && trimmed.startsWith(c.trigger));
  if (!matched) return text;
  const rest = trimmed.slice(matched.trigger.length).trim();
  return `[触发命令: ${matched.name}] ${matched.prompt}\n\n${rest}`.trim();
}

function wantsPainting(text: string): boolean {
  return PAINT_KEYWORDS.some((k) => text.includes(k));
}

/**
 * 生成一次角色回复：组装 prompt、调用 LLM、追加会话、记录统计。
 * 同时用于 QQ 消息、主动消息与本地模拟。
 */
export async function generateReply(persona: Persona, userId: string, userText: string, botId?: string): Promise<GenerateResult> {
  const settings = settingsService.get();
  const profile = profileRepo.ensure(persona.id, userId);
  const memory = buildMemoryInjection(persona.id, userId);
  const { prefix, full } = assembleSystemPrompt(persona, { memory, userHabits: profile.habits, includeTime: settings.injectSystemTime });

  const conv = conversationRepo.ensure(persona.id, userId);
  const history = conv.messages.slice(-settings.memoryInjectConversationLimit);

  const processed = applyCommands(persona, userText);
  const messages: ChatMessage[] = [
    { role: "system", content: full },
    ...history,
    { role: "user", content: processed },
  ];

  let reply: string;
  let usage: LLMUsage;
  let modelId: string | null = null;

  // 绘画意图优先
  if (canPaint(persona) && wantsPainting(userText)) {
    const painting = await generatePainting(persona, userId, userText);
    if (painting.ok) {
      reply = `（${persona.name}画好了）${painting.prompt ?? ""}`.trim();
      usage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    } else {
      reply = `（${persona.name}没法画出来：${painting.reason}）`;
      usage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    }
    conversationRepo.append(persona.id, userId, [
      { role: "user", content: processed, timestamp: Date.now() },
      { role: "assistant", content: reply, timestamp: Date.now() },
    ]);
    profileRepo.touchInteraction(persona.id, userId);
    logRepo.message({ personaId: persona.id, botId, userId, direction: "in", content: userText });
    logRepo.message({ personaId: persona.id, botId, userId, direction: "out", content: reply });
    statsRepo.increment(formatDate(), persona.id, { messages: 2 });
    syncMemoryFiles(persona, userId);
    return { reply, usage, modelId, painting };
  }

  let attemptedAbort = false;
  try {
    const { provider, model } = resolveProviderForPersona(persona);
    modelId = model?.id ?? null;
    const temperature = persona.modelConfig.temperature ?? model?.temperature;
    const maxTokens = persona.modelConfig.maxTokens ?? model?.maxTokens;
    const result = await provider.chat(messages, { temperature, maxTokens });
    reply = result.content;
    usage = result.usage;
  } catch (err) {
    attemptedAbort = (err as Error).message.includes("abort");
    logger.error({ personaId: persona.id, err: (err as Error).message }, "generate reply failed");
    reply = attemptedAbort ? "" : `（${persona.name}走神了，暂时没能回复，请稍后再试）`;
    usage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
  }

  if (attemptedAbort && !reply) {
    throw new Error("aborted");
  }

  conversationRepo.append(persona.id, userId, [
    { role: "user", content: processed, timestamp: Date.now() },
    { role: "assistant", content: reply, timestamp: Date.now() },
  ]);
  profileRepo.touchInteraction(persona.id, userId);
  logRepo.message({ personaId: persona.id, botId, userId, direction: "in", content: userText });
  logRepo.message({ personaId: persona.id, botId, userId, direction: "out", content: reply });
  logRepo.usage({ modelId, personaId: persona.id, usage });
  statsRepo.increment(formatDate(), persona.id, {
    tokenConsumed: usage.inputTokens + usage.outputTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    messages: 2,
  });
  syncMemoryFiles(persona, userId);

  // 异步更新用户画像，不阻塞回复
  void extractUserHabits(persona, userId).catch(() => undefined);

  return { reply, usage, modelId };
}

interface Batch {
  bot: Bot;
  persona: Persona;
  userId: string;
  contents: string[];
  lastEvent: QQMessageEvent;
  timer: NodeJS.Timeout | null;
  abort: AbortController | null;
  running: boolean;
}

/**
 * 消息处理管道：防抖合并 + 取消旧任务 + 单条完整回复。
 */
class MessagePipeline {
  private batches = new Map<string, Batch>();

  handle(bot: Bot, event: QQMessageEvent): void {
    if (!event.content) return;
    const persona = bot.personaId ? personaRepo.find(bot.personaId) : null;
    if (!persona || !persona.enabled) {
      logger.debug({ botId: bot.id }, "no enabled persona bound, ignore message");
      return;
    }
    const key = `${bot.id}:${event.authorId}`;
    notifyUserReplied(persona.id, event.authorId);
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { bot, persona, userId: event.authorId, contents: [], lastEvent: event, timer: null, abort: null, running: false };
      this.batches.set(key, batch);
    }
    batch.contents.push(event.content);
    batch.lastEvent = event;
    batch.persona = persona;

    // 取消正在进行的旧任务（消息打断）
    if (batch.running && batch.abort) {
      batch.abort.abort();
      batch.abort = null;
      batch.running = false;
    }
    if (batch.timer) clearTimeout(batch.timer);

    const debounce = settingsService.get().messageDebounceMs;
    batch.timer = setTimeout(() => void this.flush(key), debounce);
  }

  private async flush(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch) return;
    batch.timer = null;
    const merged = batch.contents.join("\n");
    batch.contents = [];
    if (!merged.trim()) return;

    batch.running = true;
    const abort = new AbortController();
    batch.abort = abort;

    try {
      const { reply, painting } = await generateReply(batch.persona, batch.userId, merged, batch.bot.id);
      if (abort.signal.aborted) return;
      await this.send(batch, reply, painting);
    } catch (err) {
      if ((err as Error).message !== "aborted") {
        logger.error({ key, err: (err as Error).message }, "pipeline flush failed");
      }
    } finally {
      if (batch.abort === abort) {
        batch.abort = null;
        batch.running = false;
      }
      if (!batch.timer && batch.contents.length === 0) {
        this.batches.delete(key);
      }
    }
  }

  private async send(batch: Batch, reply: string, painting?: PaintingResult): Promise<void> {
    const client = new QQApiClient(batch.bot);
    const event = batch.lastEvent;
    const settings = settingsService.get();
    try {
      if (painting?.ok && (painting.imageUrl || painting.imageBase64)) {
        const scope =
          event.type === "c2c"
            ? ({ type: "c2c", openid: event.authorId } as const)
            : event.type === "group"
              ? ({ type: "group", groupOpenid: event.groupOpenid! } as const)
              : null;
        if (scope) {
          const fileInfo = await client.uploadFile(scope, { url: painting.imageUrl, base64: painting.imageBase64 });
          if (fileInfo) {
            await client.sendImageByFileInfo(scope, fileInfo, event.msgId);
            return;
          }
        }
      }

      // 多行回复拆分为多条消息，携带同一 msg_id 与递增 msg_seq。
      // 被动回复上限：单聊 4 次 / 群聊 5 次，超出部分合并进最后一条。
      const sceneCap = event.type === "c2c" ? 4 : event.type === "group" ? 5 : settings.splitMaxMessages;
      const maxParts = Math.max(1, Math.min(settings.splitMaxMessages, sceneCap));
      const segments = settings.splitMessages ? splitReply(reply, maxParts) : [reply];
      if (!segments.length) return;

      for (let i = 0; i < segments.length; i++) {
        const msgSeq = i + 1;
        const segment = segments[i];
        if (event.type === "c2c") {
          await client.sendC2C(event.authorId, segment, event.msgId, msgSeq);
        } else if (event.type === "group") {
          await client.sendGroup(event.groupOpenid!, segment, event.msgId, msgSeq);
        } else if (event.type === "guild") {
          await client.sendGuildChannel(event.channelId!, segment, event.msgId);
        } else if (event.type === "direct") {
          await client.sendDirect(event.guildId!, segment, event.msgId);
        }
        if (i < segments.length - 1) await sleep(300);
      }
    } catch (err) {
      logger.error({ botId: batch.bot.id, err: (err as Error).message }, "send reply failed");
    }
  }

  /** 本地模拟：不经 QQ，直接返回角色回复，用于后台调试。 */
  async simulate(personaId: string, userId: string, text: string): Promise<GenerateResult> {
    const persona = personaRepo.find(personaId);
    if (!persona) throw new Error("角色不存在");
    return generateReply(persona, userId, text);
  }

  activeCount(): number {
    return this.batches.size;
  }
}

export const messagePipeline = new MessagePipeline();
