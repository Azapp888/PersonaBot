import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 独立临时数据目录，必须在导入 config 之前设置。
const dir = mkdtempSync(join(tmpdir(), "personabot-memory-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

const PERSONA = "p1";
const USER = "u1";

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

test("核心记忆：pinned 或高重要性的原子事实才会入选", async () => {
  const { memoryRepo } = await import("../src/db/repos/memories");
  memoryRepo.create({
    personaId: PERSONA,
    userId: USER,
    type: "fact",
    content: "约定周六一起看电影",
    sourceDate: "2026-01-01",
    importance: 9,
    pinned: true,
    kind: "agreement",
  });
  memoryRepo.create({
    personaId: PERSONA,
    userId: USER,
    type: "fact",
    content: "用户喜欢喝美式咖啡",
    sourceDate: "2026-01-01",
    importance: 7,
    pinned: false,
    kind: "preference",
  });
  memoryRepo.create({
    personaId: PERSONA,
    userId: USER,
    type: "fact",
    content: "今天天气不错",
    sourceDate: "2026-01-01",
    importance: 2,
    pinned: false,
    kind: "trivial",
  });

  const core = memoryRepo.listCore(PERSONA, USER, 8, 40);
  assert.equal(core.length, 1);
  assert.equal(core[0].content, "约定周六一起看电影");
});

test("剪枝：只删除早于保留窗口的日记忆，原子事实不受影响", async () => {
  const { memoryRepo } = await import("../src/db/repos/memories");
  memoryRepo.create({ personaId: PERSONA, userId: USER, type: "daily", content: "旧日记忆", sourceDate: "2026-01-01" });
  memoryRepo.create({ personaId: PERSONA, userId: USER, type: "daily", content: "新日记忆", sourceDate: "2026-01-10" });

  const removed = memoryRepo.removeDailyBefore(PERSONA, USER, "2026-01-05");
  assert.equal(removed, 1);

  const dailies = memoryRepo.listByUser(PERSONA, USER).filter((m) => m.type === "daily");
  assert.equal(dailies.length, 1);
  assert.equal(dailies[0].content, "新日记忆");

  const facts = memoryRepo.listByUser(PERSONA, USER).filter((m) => m.type === "fact");
  assert.ok(facts.length >= 3);
});

test("检索：三维打分返回相关条目并排除指定 id", async () => {
  const { memoryRepo } = await import("../src/db/repos/memories");
  const { retrieveRelevantMemories } = await import("../src/memory/relevant");
  memoryRepo.create({
    personaId: PERSONA,
    userId: USER,
    type: "daily",
    content: "用户提到自己最近在准备考研",
    sourceDate: "2026-01-10",
  });

  const hits = retrieveRelevantMemories(PERSONA, USER, "考研准备得怎么样", 4);
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].content.includes("考研"));

  const target = memoryRepo.listByUser(PERSONA, USER).find((m) => m.content.includes("考研"))!;
  const excluded = retrieveRelevantMemories(PERSONA, USER, "考研准备得怎么样", 4, [target.id]);
  assert.equal(excluded.length, 0);
});

test("检索：无关键词命中时返回空", async () => {
  const { retrieveRelevantMemories } = await import("../src/memory/relevant");
  const hits = retrieveRelevantMemories(PERSONA, USER, "毫无关联的内容zzz", 4);
  assert.equal(hits.length, 0);
});

test("实时记忆门控：短消息或未命中信号词不触发", async () => {
  const { shouldExtract } = await import("../src/memory/realtime");
  assert.equal(shouldExtract("嗯"), false);
  assert.equal(shouldExtract("哈哈哈哈哈哈"), false);
  assert.equal(shouldExtract("我们约好周六一起去看电影"), true);
  assert.equal(shouldExtract("我喜欢喝美式咖啡但不喜欢加糖"), true);
});

test("实时记忆 origin 标记为 realtime，且每日整理不会误删", async () => {
  const { memoryRepo } = await import("../src/db/repos/memories");
  memoryRepo.create({
    personaId: PERSONA,
    userId: USER,
    type: "fact",
    content: "用户习惯晚上 11 点睡",
    sourceDate: "2026-02-01",
    importance: 7,
    pinned: true,
    kind: "preference",
    origin: "realtime",
  });
  // 模拟每日整理清理同日 daily 事实：不应删除 realtime 事实
  memoryRepo.removeByTypeDate(PERSONA, USER, "fact", "2026-02-01", "daily");
  const still = memoryRepo
    .listByUser(PERSONA, USER)
    .filter((m) => m.origin === "realtime" && m.content.includes("晚上 11 点睡"));
  assert.equal(still.length, 1);
});

test("会话点迁移：把长期记忆点写入核心记忆且去重", async () => {
  const { memoryRepo } = await import("../src/db/repos/memories");
  const { migrateSessionPoints } = await import("../src/memory/service");
  const P = "p-mig";
  const U = "u-mig";

  // 约定类命中 agreement
  const first = migrateSessionPoints(P, U, ["约定周六一起看电影", "以后叫我小猫"]);
  assert.equal(first, 2);

  const facts = memoryRepo.listByUser(P, U).filter((m) => m.pinned);
  assert.equal(facts.length, 2);
  const agreement = facts.find((m) => m.content.includes("看电影"))!;
  assert.equal(agreement.kind, "agreement");
  assert.ok(agreement.importance >= 8);

  // 重复迁移应被去重跳过
  const again = migrateSessionPoints(P, U, ["约定周六一起看电影", "  ", "约定周六一起看电影"]);
  assert.equal(again, 0);

  // 核心记忆应包含迁移内容
  const core = memoryRepo.listCore(P, U, 8, 40).map((m) => m.content);
  assert.ok(core.includes("约定周六一起看电影"));
});

test("记忆文件截断：未超限原样返回，超限保尾弃头并标注", async () => {
  const { clampMemoryFile } = await import("../src/memory/service");
  assert.deepEqual(clampMemoryFile("short", 4096), { content: "short", truncated: false });

  const long = "A".repeat(100) + "尾部关键内容";
  const clamped = clampMemoryFile(long, 20);
  assert.equal(clamped.truncated, true);
  assert.ok(clamped.content.includes("最近部分"));
  assert.ok(clamped.content.includes("尾部关键内容"));
  assert.ok(Buffer.byteLength(clamped.content, "utf8") < Buffer.byteLength(long, "utf8"));
});

test("记忆文件截断：多字节字符不会残留替换符", async () => {
  const { clampMemoryFile } = await import("../src/memory/service");
  const text = "中文".repeat(100);
  const clamped = clampMemoryFile(text, 30);
  assert.ok(clamped.truncated);
  assert.ok(!clamped.content.includes("\uFFFD"), "不应出现 U+FFFD 替换字符");
});

test("记忆文件增量注入：内容未变化只返回占位，变化时更新快照", async () => {
  const { incrementalMemoryFiles, digestMemory } = await import("../src/memory/service");
  const digests: Record<string, string> = {};
  const files = { memory: "记忆 A", user: "用户 B", personaState: "状态 C" };

  const first = incrementalMemoryFiles(files, digests, 4096, true);
  assert.equal(first.memory, "记忆 A");
  assert.equal(first.user, "用户 B");
  assert.equal(digests.memory, digestMemory("记忆 A"));

  const second = incrementalMemoryFiles(files, digests, 4096, true);
  assert.equal(second.memory, "（内容与上一轮一致，未变化）");
  assert.equal(second.user, "（内容与上一轮一致，未变化）");

  const changed = incrementalMemoryFiles({ ...files, memory: "记忆 A + 新增" }, digests, 4096, true);
  assert.equal(changed.memory, "记忆 A + 新增");
  assert.equal(changed.user, "（内容与上一轮一致，未变化）");
});

test("记忆文件增量注入：关闭增量时始终返回完整内容", async () => {
  const { incrementalMemoryFiles } = await import("../src/memory/service");
  const digests: Record<string, string> = {};
  const files = { memory: "记忆 A" };
  incrementalMemoryFiles(files, digests, 4096, false);
  const again = incrementalMemoryFiles(files, digests, 4096, false);
  assert.equal(again.memory, "记忆 A");
});

test("会话重置：clear 记忆文件增量快照，强制下一会话全量注入", async () => {
  const { startNewSession, updateState, emptyState } = await import("../src/context/state");
  const s = updateState(emptyState(), "我们约好周末爬山");
  s.memoryFileDigests = { memory: "abc" };
  const next = startNewSession(s);
  assert.deepEqual(next.memoryFileDigests, {});
});

test("每日问候计数：同日累加，跨天归零", async () => {
  const { profileRepo } = await import("../src/db/repos/profiles");
  assert.equal(profileRepo.recordDailySend(PERSONA, "u2", "2026-03-01"), 1);
  assert.equal(profileRepo.recordDailySend(PERSONA, "u2", "2026-03-01"), 2);
  assert.equal(profileRepo.recordDailySend(PERSONA, "u2", "2026-03-02"), 1);
});

test("时区解析：server 别名与非法值都不会传给调度器", async () => {
  const { resolveIanaTimezone } = await import("../src/utils/clock");
  // 合法 IANA 名原样返回
  assert.equal(resolveIanaTimezone("Asia/Shanghai"), "Asia/Shanghai");
  // server 别名解析为服务器实际 IANA 时区（容器里通常是 UTC，也是合法 IANA 名）
  const server = resolveIanaTimezone("server");
  assert.equal(server, Intl.DateTimeFormat().resolvedOptions().timeZone);
  // 非法时区名返回 undefined，避免 node-cron 抛错崩溃
  assert.equal(resolveIanaTimezone("not-a-timezone"), undefined);
  assert.equal(resolveIanaTimezone(""), server);
});

test("日程：按当前时间匹配对应时段", async () => {
  const { currentSegment } = await import("../src/memory/schedule");
  const schedule = {
    personaId: "p1",
    date: "2026-01-01",
    createdAt: 0,
    segments: [
      { start: "08:00", end: "12:00", activity: "上课", note: "不能回消息" },
      { start: "12:00", end: "14:00", activity: "午休", note: "可以聊天" },
      { start: "23:00", end: "07:00", activity: "睡觉", note: "跨夜时段" },
    ],
  };
  // 用 UTC 时区固定时间点判断
  const at = (hh: number, mm: number) => Date.UTC(2026, 0, 1, hh, mm);
  assert.equal(currentSegment(schedule, "UTC", at(9, 0))?.activity, "上课");
  assert.equal(currentSegment(schedule, "UTC", at(13, 0))?.activity, "午休");
  // 跨零点时段：凌晨 2 点命中「睡觉」
  assert.equal(currentSegment(schedule, "UTC", at(2, 0))?.activity, "睡觉");
  assert.equal(currentSegment(null, "UTC", at(9, 0)), null);
});



