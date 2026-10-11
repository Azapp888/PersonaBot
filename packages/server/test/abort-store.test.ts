import { test } from "node:test";
import assert from "node:assert/strict";
import { abortActive, clearAbort, currentAbort, registerAbort } from "../src/pipeline/abort-store";

test("注册后可读取并中止", () => {
  const controller = new AbortController();
  registerAbort("k1", controller);
  assert.equal(currentAbort("k1"), controller);
  assert.equal(abortActive("k1"), true);
  assert.equal(controller.signal.aborted, true);
  // 再次中止无效
  assert.equal(abortActive("k1"), false);
  clearAbort("k1", controller);
  assert.equal(currentAbort("k1"), undefined);
});

test("clearAbort 仅在 controller 一致时清除", () => {
  const a = new AbortController();
  const b = new AbortController();
  registerAbort("k2", a);
  clearAbort("k2", b);
  assert.equal(currentAbort("k2"), a);
  clearAbort("k2", a);
  assert.equal(currentAbort("k2"), undefined);
});

test("未注册 key 的中止返回 false", () => {
  assert.equal(abortActive("missing"), false);
});
