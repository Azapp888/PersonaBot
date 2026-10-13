import { test } from "node:test";
import assert from "node:assert/strict";
import { systemClock, timeContextLine, timeContextLineMinute } from "../src/utils/clock";

test("systemClock.snapshot 返回完整字段", () => {
  const snap = systemClock.snapshot("Asia/Shanghai");
  assert.equal(snap.timezone, "Asia/Shanghai");
  assert.match(snap.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(snap.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.ok(snap.hour >= 0 && snap.hour <= 23);
  assert.ok(snap.minute >= 0 && snap.minute <= 59);
});

test("snapshotAt 按指定时区换算同一时刻", () => {
  // 2026-10-11T00:00:00Z -> 北京时间为 08:00
  const ts = Date.parse("2026-10-11T00:00:00Z");
  const shanghai = systemClock.snapshotAt(ts, "Asia/Shanghai");
  assert.equal(shanghai.date, "2026-10-11");
  assert.equal(shanghai.hour, 8);
  assert.equal(shanghai.utcOffsetMinutes, 480);

  const utc = systemClock.snapshotAt(ts, "UTC");
  assert.equal(utc.hour, 0);
});

test("无效时区回退而非抛错", () => {
  const snap = systemClock.snapshot("Not/AZone");
  assert.ok(snap.timezone.length > 0);
  assert.match(snap.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("timeContextLine 含当前时间与时区", () => {
  const line = timeContextLine("Asia/Shanghai", Date.parse("2026-01-01T00:00:00Z"));
  assert.ok(line.includes("当前时间"));
  assert.ok(line.includes("Asia/Shanghai"));
  assert.ok(line.includes("UTC+08:00"));
});

test("timeContextLineMinute 精确到分钟且不含秒", () => {
  // 2026-01-01T00:34:56Z -> 北京时间 08:34
  const line = timeContextLineMinute("Asia/Shanghai", Date.parse("2026-01-01T00:34:56Z"));
  assert.ok(line.includes("2026-01-01 08:34"));
  // 同一分钟内的不同秒，必须产生完全一致的文本（缓存前缀稳定）
  const sameMinute = timeContextLineMinute("Asia/Shanghai", Date.parse("2026-01-01T00:34:02Z"));
  assert.equal(line, sameMinute);
  // 不含秒级时间片段
  assert.ok(!line.includes(":56"));
});
