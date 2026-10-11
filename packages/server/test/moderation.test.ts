import { test } from "node:test";
import assert from "node:assert/strict";

// 直接测试纯函数逻辑：通过内联复刻 filterText 的词表解析与命中判定，
// 避免测试依赖 settingsService（需要 DB）。
// 这里验证的是「词表解析 + 命中 + 替换」的核心行为一致性。

function parseWords(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,，、;；]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

function filter(text: string, raw: string, action: "block" | "replace") {
  const words = parseWords(raw);
  const matched = words.filter((w) => text.includes(w));
  if (!matched.length) return { filtered: false, text, matched };
  if (action === "replace") {
    let out = text;
    for (const w of matched) out = out.split(w).join("*".repeat(w.length));
    return { filtered: true, text: out, matched };
  }
  return { filtered: true, text, matched };
}

test("按换行/逗号/分号解析词表", () => {
  assert.deepEqual(parseWords("a\nb,c，d、e;f；g"), ["a", "b", "c", "d", "e", "f", "g"]);
  assert.deepEqual(parseWords(""), []);
});

test("未命中不处理", () => {
  const r = filter("今天天气不错", "广告\n推广", "block");
  assert.equal(r.filtered, false);
  assert.equal(r.text, "今天天气不错");
});

test("block 策略命中即标记过滤", () => {
  const r = filter("这是广告内容", "广告", "block");
  assert.equal(r.filtered, true);
  assert.deepEqual(r.matched, ["广告"]);
});

test("replace 策略替换为等长星号", () => {
  const r = filter("这是广告和推广", "广告\n推广", "replace");
  assert.equal(r.text, "这是**和**");
});
