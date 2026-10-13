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


