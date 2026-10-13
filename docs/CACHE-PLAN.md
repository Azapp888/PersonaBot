# Prompt 缓存命中率优化预案

## 一、问题现象

账单里各模型的「缓存命中 / 输入」比例（读图数据）：

| 模型 | 输入 | 缓存命中 | 命中率 |
|------|------|---------|--------|
| glm-5-3-flash | 1,338,341 | 0 | 0% |
| doubao-seed-character | 1,206,869 | 189,828 | 15.7% |
| deepseek-v4-flash-ga | 121,942 | 0 | 0% |
| deepseek-v4-1-flash | 408,326 | 80,896 | 19.8% |
| deepseek-v4-pro-ga | 1,240 | 0 | 0% |

整体命中率明显偏低。要解决它，先要判断：**这是代码的锅，还是供应商的锅。** 两者解法完全不同。

---

## 二、根因诊断（按可能性排序）

### 根因 1：命中率统计口径错了（最可能，直接影响你看到的数字）

当前 `stats` 只统计 `cacheHitTokens / cacheMissTokens`，但在 `packages/server/src/llm/openai.ts:76`：

```ts
const cachedFromOpenAI = usage?.prompt_tokens_details?.cached_tokens;
const deepseekHit = usage?.prompt_cache_hit_tokens;
const deepseekMiss = usage?.prompt_cache_miss_tokens;
```

问题：**缓存字段名按 provider 类型写死**（`cacheStyle: "deepseek" | "openai"`）。而 glm（智谱）、doubao（火山方舟）都是走 OpenAI 兼容协议接入的，被归到 `cacheStyle: "openai"`。

- glm 实际缓存字段可能是 `prompt_tokens_details.cached_tokens`，也可能完全不返回缓存字段 → 若字段对不上，一律记 0，**于是 glm 显示 0%。**
- 豆包方舟有时返回 `prompt_tokens_details.cached_tokens`，也有版本用 `prompt_cache_hit_tokens`。

**结论：glm 那 0% 很可能不是没缓存，而是没解析到。** 需要先确认每家真实返回字段（用日志打印一次原始 `usage` 对象即可）。

### 根因 2：稳定前缀被动态内容污染（代码问题，最影响真实命中）

缓存命中的铁律是**前缀逐字节不变**。当前设计（`docs/DESIGN.md` 第 3 节）声称「稳定前缀 + 动态后缀」，但实际 `assembleSystemPrompt`（`packages/server/src/persona/prompt.ts:123`）返回的 `full` 是：

```
system = prefix + "\n" + suffix
```

`suffix`（`buildDynamicSuffix`）**每轮都在变**，而且顺序是：

```
当前时间 → 核心记忆 → 日程 → 记忆文件 → 相关记忆 → 对话摘要 → Agent说明 → 当前状态
```

这里有两个致命点：

1. **时间在动态后缀最前面** (`prompt.ts:74`)。时间每秒都变，意味着 **system prompt 从第 2 个字符起就不再与前一轮相同**。OpenAI/DeepSeek 的自动缓存是**从头匹配最长公共前缀**，时间一变，公共前缀长度 ≈ 0，后面所有内容全部 miss。
   
   这是当前命中率低的最大原因。**哪怕后面 5000 字全一样，只要"当前时间"在最前面且逐秒变，缓存就等于没有。**

2. **后缀内部顺序不稳定**：核心记忆条数/顺序会随记忆增删变化；日程每天变一次；记忆文件每次 `syncMemoryFiles` 重写。这些都在时间之后，进一步压缩可复用区段。

对比：Anthropic 是**显式 `cache_control` 断点**，不依赖"前缀自然一致"，所以 anthropic 命中率通常没问题；OpenAI/DeepSeek/glm/豆包的自动缓存则完全依赖前缀稳定性 —— 这正是本项目的重灾区。

### 根因 3：请求间隔超过缓存 TTL

自动缓存有生存期（OpenAI ~5-10 分钟、DeepSeek 视负载、豆包约数十分钟）。QQ 场景用户发消息往往是**隔几十分钟到几小时**，缓存早过期，每轮都是全新请求 → miss 属正常。这部分只能靠"把可缓存前缀做长做稳"来摊薄，无法完全消除。

### 根因 4：防抖合并 + 打断导致同一前缀被反复重算

`message-pipeline.ts` 的防抖（`messageDebounceMs` 默认 1200ms）、打断（AbortController）会让一次生成作废。作废的那次也计入了 miss 输入，拉低命中率。高频连续发消息时尤其明显。

### 根因 5：Agent 模式把工具 schema + 多轮工具回填塞进请求

`agent/index.ts` 的 `runAgentLoop` 最多 5 轮，每轮 `messages` 都在增长（工具输出回填）。工具调用轮次天然难命中，且 `run_shell` 工具说明定义为常量、位置稳定还好，但**多轮循环里前缀持续扩张**，命中率会被稀释。

---

## 三、开源项目是怎么做的（可借鉴的成熟方案）

### 1. LangChain / LangGraph —— 消息分区 + 显式缓存断点

主流做法是把 System prompt 拆成两块：
- **静态块**（角色设定、技能）：永不变，放最前。
- **半静态块**（记忆、日期）：变化频率低，置于第二段。
- **易变块**（当前时间、当前状态）：置于**最后**，且尽量精简。

Anthropic 系用 `cache_control: {type:"ephemeral"}` 打在静态块末尾，显式声明断点。

### 2. OpenAI / DeepSeek 官方建议

**「把不变的内容放前面、多变的内容放最后」**，并把 system prompt 拆成可独立缓存的多段。DeepSeek 文档明确：缓存以 **prefix 为单位**，任意位置插入变化都会让其后全部失效。DeepSeek 还建议**把时间、状态等放到 user 消息里**，而不是 system prompt。

### 3. Claude Code / Cursor 等编程 Agent

它们的 system prompt 动辄上万 token，但要几秒一次调用，命中率仍能 >80%，核心手法：

- **System prompt 完全静态**，所有动态信息（打开的文件、cwd、时间）都放**每条 user 消息**里。
- **历史消息 append-only**：只追加、从不改写、不回填、不重排 → 天然形成长前缀。
- 工具定义（schema）作为**固定前缀的一部分**，且顺序固定（很多框架还会对 tools 做字典序排序以保证稳定）。

### 4. Generative Agents / 记忆系统类项目

记忆检索结果**不写进 system prompt 开头**，而是作为**当前 user turn 的附加上下文**注入，system 保持稳定。这样跨用户/跨轮次的 system 前缀仍可复用。

### 关键启发

> **时间、记忆、状态这类多变内容，应该放在"对话消息区"，而不是 system prompt 里；system prompt 越静态越好。**

本项目恰好把**最多变的时间**放在了 system 的**动态后缀最前面**，这是与业界做法完全相反的一处，是首要优化点。

---

## 四、优化预案（分阶段，按性价比排序）

### 阶段 0：先测量，别瞎改（0.5h，必做）

1. 在 `openai.ts` 的 `buildUsage` 前打印一次原始 `usage`，确认 glm / 豆包 / deepseek 各自真实字段名与是否返回缓存数据。
2. 给 `stats` 增加 `cacheHitTokens` 之外，记录 `provider`、`modelId` 维度，方便按模型看命中率（现在只有 persona 维度）。
3. 结论产出：哪些 0% 是"没解析"，哪些是"真没命中"。

**产出**：一份"字段对照表"，后面所有优化才有的放矢。

### 阶段 1：System Prompt 重排（1-2h，收益最大）

把 `buildDynamicSuffix` 内容**按变化频率从低到高重排，并把最易变的放最末尾**，同时把「当前时间」从 system 移到 user 消息：

```
# 稳定前缀（buildStablePrefix，永不变）
角色设定 / 性格 / 技能 / 命令

# 半静态段（低频变，顺序固定）
记忆档案（MEMORY.md / USER.md / persona-state.md，按固定顺序）
核心记忆（固定排序：按 importance desc, id asc）

# 动态段（每天一变）
日程

# 最末尾（每轮一变，且精简）
对话摘要 / 相关记忆 / 当前状态

# 【移出 system】当前时间 → 放进 user message 末尾
```

- 时间改注入到 `buildUserContent` 里（每条 user 消息开头或结尾加一行 `当前时间：...`），彻底消除"逐秒破坏前缀"的问题。
- 动态段内部字段**排序必须确定**（记忆按 id、相关记忆按 score 再按 id，避免 Set 顺序抖动）。
- 记忆文件不要每轮 `syncMemoryFiles` 重写内容后再注入（写盘时机与注入解耦）。

**预期**：把可复用前缀从「≈0」提升到「稳定前缀 + 半静态段」，命中率可望大幅提升。

### 阶段 2：给缓存做"分层断点"（2-3h）

- Anthropic：现在只有一整块 system 一个 cache_control。改成**两个断点**：静态块末尾 + 半静态块末尾，让记忆变化时只失效后半段。
- OpenAI/DeepSeek/glm/豆包：自动缓存无断点，靠阶段 1 的"稳定前缀"即可；但要确保 **tools 定义顺序固定**（目前 `agent` 只有 1 个工具，问题不大）。

### 阶段 3：Provider 缓存解析健壮化（1h）

改 `buildUsage`：**不再靠 `cacheStyle` 猜**，而是"探测式"解析：

```
cached = usage.prompt_tokens_details?.cached_tokens
       ?? usage.prompt_cache_hit_tokens
       ?? usage.cache_read_input_tokens
       ?? 0
```

按模型名兜底，并加一条 debug 日志在字段缺失时告警，避免"静默记 0"。

### 阶段 4：降低无效请求（可选，1h）

- 打断/防抖导致的废请求不统计或单独标记，避免污染命中率分母。
- 评估 `messageDebounceMs` 与打断策略，减少"发一半就取消"。

---

## 五、预期收益与取舍

| 阶段 | 工作量 | 风险 | 预期命中率 |
|------|--------|------|-----------|
| 0 测量 | 0.5h | 无 | 澄清真假 0% |
| 1 重排 + 时间外移 | 1-2h | 低（改注入位置） | 主要提升，跨轮命中 |
| 2 分层断点 | 2-3h | 低 | 记忆更新时不全失效 |
| 3 解析健壮化 | 1h | 无 | 统计更真实 |

**核心结论：命中率低的首要代码原因是「当前时间被放在 system prompt 动态后缀的最前面，导致前缀每轮从首字节就失效」。把它移到 user 消息、并把 system 按变化频率重排，是投入产出比最高的一步。**

---

## 六、需要你确认的点

1. 是否先做**阶段 0 测量**（不改行为，只加日志），拿到真实字段再决定后续？
2. glm / 豆包是否值得单独适配（它们缓存字段可能与 deepseek/openai 都不同）？
3. 时间注入从 system 移到 user 消息，属于**行为可感知变更**（模型看到时间的位置变了）。你接受吗？还是坚持时间留在 system、只做"放到最末尾"的折中方案？

---

## 七、已实施方案（按用户确认的口径）

用户拍板：**统一前缀 + 时间精确到分钟 + 时间放 system 末尾（不放 user 消息）+ 优先适配火山引擎**。已全部落地：

1. **`packages/server/src/utils/clock.ts`**：新增 `timeContextLineMinute()`，时间精确到分钟、不含秒；同一分钟内多个秒值产生完全一致的文本。
2. **`packages/server/src/persona/prompt.ts`**：`buildDynamicSuffix` 按「变化频率从低到高」重排：
   记忆档案 → 核心记忆 → 日程 → 相关记忆 → 对话摘要 → Agent 说明 → 当前状态 → **当前时间（最末尾）**。
   时间不再位于开头，其前方的全部内容构成稳定可复用前缀。
3. **`packages/server/src/memory/relevant.ts`**：相关记忆排序加 content 次关键字，消除同分抖动。
4. **`packages/server/src/llm/openai.ts`**：缓存解析改为探测式 `parseUsage()`，按 `cacheStyle` 给优先顺序后逐项兜底（`prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens` / `cache_read_input_tokens`），不再因字段名不匹配而一律记 0。
5. **火山引擎适配**：`ModelProvider` 新增 `volcengine`；`factory.ts` 加默认 base（`ark.cn-beijing.volces.com/api/v3`）并识别 `doubao-*` / `volces.com` 走 `cacheStyle: "volcengine"`；`discover.ts` 加 base；`vision.ts` 加方舟视觉知识库；admin 模型页新增「火山引擎方舟（豆包）」选项与默认值。
6. **测试**：`test/prompt-cache.test.ts`（缓存解析 4 项 + 前缀稳定性 2 项）、`test/clock.test.ts` 加分钟精度 1 项。测试总数 82 → 89，全绿；typecheck / lint / build 全过。

**已修的首因：当前时间曾是 system prompt 的第一行，逐秒变化导致缓存前缀从首字节失效。现在时间归一到分钟并挪到末尾，可复用前缀显著拉长。**

