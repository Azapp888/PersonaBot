/**
 * 将模型的多行回复拆分为多条消息。
 * - 按换行拆分，去除空白行；
 * - 若分片数超过 maxParts，则把超出部分合并进最后一条，避免超出 QQ 被动回复次数上限。
 */
export function splitReply(text: string, maxParts: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (parts.length <= 1) return [trimmed];

  const limit = Math.max(1, Math.floor(maxParts));
  if (parts.length <= limit) return parts;

  const head = parts.slice(0, limit - 1);
  const tail = parts.slice(limit - 1).join("\n");
  return [...head, tail];
}
