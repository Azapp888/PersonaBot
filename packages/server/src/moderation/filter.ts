import { settingsService } from "../settings/service";

/**
 * 敏感词 / 关键词过滤。
 *
 * 词表由设置项 `keywordFilterWords` 提供（换行或逗号分隔），默认关闭，
 * 属于可选的运营能力而非强制内容审查。命中用户消息后按 `keywordFilterAction`：
 * - block：拦截该条消息，不进入模型，回以固定提示；
 * - replace：将命中词替换为等长的 `*`，继续进入模型。
 */
export type KeywordAction = "block" | "replace";

export interface KeywordFilterResult {
  filtered: boolean;
  action: KeywordAction;
  text: string;
  matched: string[];
}

function parseWords(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,，、;；]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

export function filterText(text: string): KeywordFilterResult {
  const settings = settingsService.get();
  const action: KeywordAction = settings.keywordFilterAction === "replace" ? "replace" : "block";
  if (!settings.keywordFilterEnabled || !text) {
    return { filtered: false, action, text, matched: [] };
  }
  const words = parseWords(settings.keywordFilterWords);
  if (!words.length) return { filtered: false, action, text, matched: [] };

  const matched = words.filter((w) => text.includes(w));
  if (!matched.length) return { filtered: false, action, text, matched };

  if (action === "replace") {
    let out = text;
    for (const w of matched) {
      out = out.split(w).join("*".repeat(w.length));
    }
    return { filtered: true, action, text: out, matched };
  }
  return { filtered: true, action, text, matched };
}

/** 供测试与运维读取当前词表。 */
export function currentWords(): string[] {
  return parseWords(settingsService.get().keywordFilterWords);
}
