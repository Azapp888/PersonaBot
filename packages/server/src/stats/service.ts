import { getDb } from "../db";
import { botRepo } from "../db/repos/bots";
import { statsRepo } from "../db/repos/stats";
import { personaRepo } from "../db/repos/personas";
import { logRepo } from "../db/repos/logs";
import { summarizeConsistency } from "../persona/consistency";
import { addDays, formatDate, startOfDay } from "../utils/id";

function hitRate(hit: number, miss: number): number {
  const total = hit + miss;
  return total > 0 ? Number(((hit / total) * 100).toFixed(2)) : 0;
}

export const statsService = {
  dashboard() {
    const today = formatDate();
    const rows = statsRepo.byDate(today);
    const tokenConsumed = rows.reduce((s, r) => s + r.tokenConsumed, 0);
    const cacheHit = rows.reduce((s, r) => s + r.cacheHitTokens, 0);
    const cacheMiss = rows.reduce((s, r) => s + r.cacheMissTokens, 0);
    const imagesGenerated = rows.reduce((s, r) => s + r.imagesGenerated, 0);
    const messages = rows.reduce((s, r) => s + r.messages, 0);

    const personas = personaRepo.list();
    const personaName = new Map(personas.map((p) => [p.id, p.name]));
    const perPersona = rows.map((r) => ({
      personaId: r.personaId,
      name: personaName.get(r.personaId) ?? r.personaId,
      tokens: r.tokenConsumed,
      messages: r.messages,
      images: r.imagesGenerated,
    }));

    const msgRows = getDb()
      .prepare(
        `SELECT bot_id AS botId, COUNT(*) AS c FROM message_logs WHERE created_at >= ? GROUP BY bot_id`,
      )
      .all(startOfDay()) as any[];
    const bots = botRepo.list();
    const botName = new Map(bots.map((b) => [b.id, b.name]));
    const perBot = msgRows.map((r) => ({
      botId: r.botId,
      name: r.botId ? (botName.get(r.botId) ?? r.botId) : "未绑定",
      messages: r.c,
    }));

    return {
      date: today,
      tokenConsumed,
      cacheHitTokens: cacheHit,
      cacheMissTokens: cacheMiss,
      cacheHitRate: hitRate(cacheHit, cacheMiss),
      imagesGenerated,
      messages,
      activeBots: bots.filter((b) => b.enabled).length,
      totalBots: bots.length,
      totalPersonas: personas.length,
      perPersona,
      perBot,
      personaConsistency: summarizeConsistency(personas),
    };
  },

  trends(days = 14) {
    const end = formatDate();
    const start = formatDate(addDays(new Date(), -(days - 1)));
    const rows = statsRepo.range(start, end);
    const byDate = new Map<string, { tokens: number; hit: number; miss: number; images: number; messages: number }>();
    for (let i = 0; i < days; i++) {
      byDate.set(formatDate(addDays(new Date(), -(days - 1 - i))), { tokens: 0, hit: 0, miss: 0, images: 0, messages: 0 });
    }
    for (const r of rows) {
      const entry = byDate.get(r.date) ?? { tokens: 0, hit: 0, miss: 0, images: 0, messages: 0 };
      entry.tokens += r.tokenConsumed;
      entry.hit += r.cacheHitTokens;
      entry.miss += r.cacheMissTokens;
      entry.images += r.imagesGenerated;
      entry.messages += r.messages;
      byDate.set(r.date, entry);
    }
    return [...byDate.entries()].map(([date, v]) => ({
      date,
      tokens: v.tokens,
      images: v.images,
      messages: v.messages,
      cacheHitRate: hitRate(v.hit, v.miss),
    }));
  },

  perPersonaTrends(personaId: string, days = 14) {
    const start = formatDate(addDays(new Date(), -(days - 1)));
    const end = formatDate();
    const rows = statsRepo.rangeByPersona(personaId, start, end);
    return rows.map((r) => ({
      date: r.date,
      tokens: r.tokenConsumed,
      images: r.imagesGenerated,
      messages: r.messages,
      cacheHitRate: hitRate(r.cacheHitTokens, r.cacheMissTokens),
    }));
  },

  recentMessages(limit = 50) {
    return getDb()
      .prepare(`SELECT * FROM message_logs ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
  },
};
