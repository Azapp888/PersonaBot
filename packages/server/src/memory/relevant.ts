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

/**
 * 检索与 query 相关的记忆片段（按关键词命中数排序），只返回 Top-K。
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
  const scored: RelevanceHit[] = [];
  for (const m of rows) {
    const haystack = m.content.toLowerCase();
    let score = 0;
    for (const k of keywords) {
      if (haystack.includes(k)) score += k.length >= 2 ? 1 : 0;
    }
    if (score > 0) scored.push({ sourceDate: m.sourceDate, content: m.content, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
