import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGuardrail,
  emptyState,
  isSessionExpired,
  renderState,
  sanitizeReply,
  startNewSession,
  updateState,
  violatesGuardrail,
} from "../src/context/state";

test("检测到未完成作业时标记 homeworkUnfinished", () => {
  const s = updateState(emptyState(), "数学作业还没写完");
  assert.equal(s.homeworkUnfinished, true);
  assert.ok(s.pendingSubjects.includes("数学"));
});

test("完成后移除待完成科目", () => {
  let s = updateState(emptyState(), "数学作业还没写完");
  s = updateState(s, "数学写完了");
  assert.equal(s.homeworkUnfinished, false);
  assert.ok(s.completedSubjects.includes("数学"));
});

test("作业未完成时识别违规催睡词", () => {
  const s = updateState(emptyState(), "物理还没写完");
  assert.equal(violatesGuardrail("早点睡吧，明天再写", s), true);
  assert.equal(violatesGuardrail("我们先做第一题吧", s), false);
});

test("作业已完成时不生成守卫、不拦截", () => {
  const s = emptyState();
  assert.equal(buildGuardrail(s, "叶瑄"), null);
  assert.equal(violatesGuardrail("早点休息", s), false);
});

test("buildGuardrail 在未完成时禁止催睡并点名科目", () => {
  const s = updateState(emptyState(), "化学没写完");
  const g = buildGuardrail(s, "叶瑄");
  assert.ok(g && g.includes("化学"));
  assert.ok(g.includes("禁止"));
});

test("sanitizeReply 移除违规句子", () => {
  const out = sanitizeReply("今天好累吧。早点睡吧。我陪你把这道题拆开。");
  assert.ok(!out.includes("早点睡"));
  assert.ok(out.includes("拆开"));
});

test("renderState 反映未完成状态", () => {
  const s = updateState(emptyState(), "英语没做完");
  assert.ok(renderState(s).includes("未完成"));
});

test("会话超时：超过阈值判定为新会话，阈值内沿用", () => {
  const base = { ...emptyState(), sessionStartedAt: 1_000_000, updatedAt: 1_000_000 };
  assert.equal(isSessionExpired(base, 30 * 60_000, 1_000_000 + 29 * 60_000), false);
  assert.equal(isSessionExpired(base, 30 * 60_000, 1_000_000 + 30 * 60_000), true);
  // 阈值为 0 表示不启用超时
  assert.equal(isSessionExpired(base, 0, 1_000_000 + 10 * 60 * 60_000), false);
});

test("startNewSession 清空会话级缓存但保留长期记忆点由调用方处理", () => {
  let s = updateState(emptyState(), "数学还没写完，我很焦虑");
  s = updateState(s, "我们约好周末一起去看电影");
  assert.ok(s.longTermPoints.length > 0);

  const next = startNewSession(s, 2_000_000);
  assert.equal(next.homeworkUnfinished, false);
  assert.deepEqual(next.pendingSubjects, []);
  assert.deepEqual(next.mood, []);
  assert.deepEqual(next.longTermPoints, []);
  assert.equal(next.sessionStartedAt, 2_000_000);
});
