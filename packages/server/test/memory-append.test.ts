import { test } from "node:test";
import assert from "node:assert/strict";
import { APPEND_MARKER, normalizeAppendLines, splitAppendRegion } from "../src/memory/service";

test("无追加标记时整体视为用户原文", () => {
  const { base, appended } = splitAppendRegion("# 标题\n用户写的内容");
  assert.equal(base, "# 标题\n用户写的内容");
  assert.equal(appended, "");
});

test("有追加标记时按标记切分", () => {
  const content = `用户原文\n\n${APPEND_MARKER}\n### 2026-01-01\nAI 追加`;
  const { base, appended } = splitAppendRegion(content);
  assert.equal(base.trim(), "用户原文");
  assert.ok(appended.includes("AI 追加"));
  assert.ok(!base.includes("AI 追加"));
});

test("normalizeAppendLines 去掉空行、去重并保持顺序", () => {
  assert.deepEqual(normalizeAppendLines("a\n\n b \n\na\n"), ["a", " b"]);
  assert.deepEqual(normalizeAppendLines("a\n\n\n"), ["a"]);
});

test("normalizeAppendLines 对完全相同的行去重", () => {
  assert.deepEqual(normalizeAppendLines("x\ny\nz"), ["x", "y", "z"]);
  assert.deepEqual(normalizeAppendLines("x\nx\nx"), ["x"]);
});
