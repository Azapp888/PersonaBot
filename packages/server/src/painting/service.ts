import { settingsService } from "../settings/service";
import { logRepo } from "../db/repos/logs";
import { statsRepo } from "../db/repos/stats";
import { logger } from "../logger";
import { fetchWithTimeout } from "../utils/http";
import type { Persona } from "../types";
import { formatDate, startOfDay } from "../utils/id";

export interface PaintingResult {
  ok: boolean;
  reason?: string;
  imageUrl?: string;
  imageBase64?: string;
  prompt?: string;
}

export function canPaint(persona: Persona): boolean {
  const settings = settingsService.get();
  return (
    settings.paintingEnabled &&
    persona.paintingConfig.enabled &&
    !!persona.personality.canPaint
  );
}

function buildPaintingPrompt(persona: Persona, scene: string): string {
  const cfg = persona.paintingConfig;
  const parts = [
    cfg.style && `画风：${cfg.style}`,
    cfg.artistReference && `画师参考：${cfg.artistReference}`,
    cfg.characterDna && `角色外观 DNA：${cfg.characterDna}`,
    scene && `当前场景：${scene}`,
  ].filter(Boolean);
  return parts.join("\n");
}

function checkDailyLimits(persona: Persona, userId: string): string | null {
  const settings = settingsService.get();
  const since = startOfDay();
  const personaCount = logRepo.paintingCountSince(persona.id, userId, since);
  if (personaCount >= settings.paintingPersonaDailyLimit) {
    return `角色「${persona.name}」今日绘画次数已达上限（${settings.paintingPersonaDailyLimit}）`;
  }
  const globalCount = logRepo.paintingCountGlobalSince(since);
  if (globalCount >= settings.paintingGlobalDailyLimit) {
    return `全局今日绘画次数已达上限（${settings.paintingGlobalDailyLimit}）`;
  }
  return null;
}

/**
 * 依据角色画风配置 + 当前对话内容生成绘画提示词并调用图片模型。
 */
export async function generatePainting(persona: Persona, userId: string, scene: string): Promise<PaintingResult> {
  if (!canPaint(persona)) {
    return { ok: false, reason: "该角色未启用绘画能力" };
  }
  const limitReason = checkDailyLimits(persona, userId);
  if (limitReason) {
    return { ok: false, reason: limitReason };
  }

  const settings = settingsService.get();
  const prompt = buildPaintingPrompt(persona, scene);
  const apiBase = (settings.paintingApiBase || "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = settings.paintingApiKey;

  if (!apiKey) {
    logger.warn({ personaId: persona.id }, "painting api key not configured");
    return { ok: false, reason: "未配置绘画 API Key，请在系统设置中填写", prompt };
  }

  try {
    const res = await fetchWithTimeout(`${apiBase}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: settings.paintingModel || "gpt-image-1",
        prompt,
        n: 1,
        size: settings.paintingSize || "1024x1024",
      }),
      timeoutMs: 120000,
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn({ status: res.status, body: text }, "painting request failed");
      return { ok: false, reason: `绘画服务错误: ${res.status}`, prompt };
    }
    const data: any = JSON.parse(text);
    const item = data?.data?.[0] ?? {};
    const imageUrl = item.url as string | undefined;
    const imageBase64 = item.b64_json as string | undefined;

    logRepo.painting({ personaId: persona.id, userId, prompt, imageUrl: imageUrl ?? null });
    statsRepo.increment(formatDate(), persona.id, { imagesGenerated: 1 });
    return { ok: true, imageUrl, imageBase64, prompt };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "painting request threw");
    return { ok: false, reason: `绘画请求失败: ${(err as Error).message}`, prompt };
  }
}
