import { memoryRepo } from "../db/repos/memories";

/**
 * 轻量级中文/英文关键词切分。
 * 中文按 2-gram 与 3-gram 生成候选词，英文数字按单词切分。
 * 目的：为「按当前话题检索相关记忆」提供简单的匹配信号，避免把全部记忆塞进 prompt。
 */
export function tokenize(text: string): string[] {
  const found = new Set<string>();
  const cleaned = (text || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, " ").trim();
  if (!cleaned) return [];
  for (const word of cleaned.split(/\s+/)) {
    if (!word) continue;
    if (/^[a-zA-Z0-9]+$/.test(word)) {
      if (word.length >= 2) found.add(word.toLowerCase());
      continue;
    }
    for (let i = 0; i < word.length; i++) {
      if (word.length - i >= 2) found.add(word.slice(i, i + 2));
      if (word.length - i >= 3) found.add(word.slice(i, i + 3));
    }
  }
  return Array.from(found);
}

export interface RelevanceHit {
  sourceDate: string;
  content: string;
  score: number;
}

/** 三维打分权重：相关性 / 重要性 / 新鲜度（参考 Generative Agents）。 */
const WEIGHT_RELEVANCE = 0.5;
const WEIGHT_IMPORTANCE = 0.3;
const WEIGHT_RECENCY = 0.2;
/** 新鲜度衰减半衰期（天）。 */
const RECENCY_HALF_LIFE_DAYS = 30;

function normalize(values: number[]): number[] {
  const max = Math.max(...values, 0);
  return values.map((v) => (max > 0 ? v / max : 0));
}

/**
 * 检索与 query 相关的记忆片段，按「相关性 + 重要性 + 新鲜度」三维加权排序，只返回 Top-K。
 * 相关性用轻量关键词命中近似（避免引入 embedding）；候选需至少命中一个关键词。
 * excludeIds 用于排除已经在分层注入中出现的记忆，避免重复占 Token。
 */
export function retrieveRelevantMemories(
  personaId: string,
  userId: string,
  query: string,
  topK = 4,
  excludeIds: string[] = [],
): RelevanceHit[] {
  const keywords = tokenize(query);
  if (!keywords.length) return [];
  const excluded = new Set(excludeIds);
  const rows = memoryRepo.listByUser(personaId, userId).filter((m) => !excluded.has(m.id));
  const now = Date.now();

  const candidates: { row: (typeof rows)[number]; relevance: number; importance: number; recency: number }[] = [];
  for (const m of rows) {
    const haystack = m.content.toLowerCase();
    let relevance = 0;
    for (const k of keywords) {
      if (k.length >= 2 && haystack.includes(k)) relevance += 1;
    }
    if (relevance <= 0) continue;
    const ageDays = Math.max(0, (now - m.createdAt) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
    const importance = Math.max(1, Math.min(10, m.importance)) / 10;
    candidates.push({ row: m, relevance, importance, recency });
  }

  const relNorm = normalize(candidates.map((c) => c.relevance));
  const scored: RelevanceHit[] = candidates.map((c, i) => ({
    sourceDate: c.row.sourceDate,
    content: c.row.content,
    score: WEIGHT_RELEVANCE * relNorm[i] + WEIGHT_IMPORTANCE * c.importance + WEIGHT_RECENCY * c.recency,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
