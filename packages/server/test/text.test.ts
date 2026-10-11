import { test } from "node:test";
import assert from "node:assert/strict";
import { splitReply } from "../src/utils/text";

test("空字符串返回空数组", () => {
  assert.deepEqual(splitReply("   ", 4), []);
});

test("单行原样返回", () => {
  assert.deepEqual(splitReply("只有一行", 4), ["只有一行"]);
});

test("按行拆分且不超过上限", () => {
  const text = "第一行\n第二行\n第三行";
  assert.deepEqual(splitReply(text, 4), ["第一行", "第二行", "第三行"]);
});

test("超出上限的行合并进最后一条", () => {
  const text = "a\nb\nc\nd\ne";
  const parts = splitReply(text, 3);
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "a");
  assert.equal(parts[1], "b");
  assert.equal(parts[2], "c\nd\ne");
});

test("去除空白行", () => {
  assert.deepEqual(splitReply("a\n\n\nb", 4), ["a", "b"]);
});
