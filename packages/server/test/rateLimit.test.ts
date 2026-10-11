import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/utils/rateLimit";

test("窗口内允许至多 max 次", () => {
  const rl = new RateLimiter({ windowMs: 1000, max: 3 });
  const t = 1000;
  assert.equal(rl.hit("ip", t), true);
  assert.equal(rl.hit("ip", t), true);
  assert.equal(rl.hit("ip", t), true);
  assert.equal(rl.hit("ip", t), false);
});

test("不同 key 互不影响", () => {
  const rl = new RateLimiter({ windowMs: 1000, max: 1 });
  assert.equal(rl.hit("a", 1000), true);
  assert.equal(rl.hit("b", 1000), true);
  assert.equal(rl.hit("a", 1000), false);
});

test("窗口过期后重置计数", () => {
  const rl = new RateLimiter({ windowMs: 1000, max: 1 });
  assert.equal(rl.hit("ip", 1000), true);
  assert.equal(rl.hit("ip", 1000), false);
  assert.equal(rl.hit("ip", 2500), true);
});

test("reset 清除计数", () => {
  const rl = new RateLimiter({ windowMs: 1000, max: 1 });
  rl.hit("ip", 1000);
  rl.reset("ip");
  assert.equal(rl.hit("ip", 1000), true);
});
