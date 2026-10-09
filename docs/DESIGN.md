# PersonaBot 关键设计决策

本文档记录各模块的关键设计决策与取舍。

## 1. 单进程管理后台 + 独立 Bot 服务

管理后台与 REST API 同进程挂载，通过 `@fastify/static` 直接托管前端构建产物，部署时只需一个端口，降低运维成本。Bot 网关（WebSocket）作为同一进程内的后台任务运行，同时保留以 systemd / pm2 独立托管进程的能力。

## 2. SQLite + 手写迁移

选择 better-sqlite3（同步 API、零外部依赖、单文件）满足「部署轻、依赖少」。迁移不使用 ORM，而是用带 id 的 SQL 迁移数组 + `_migrations` 表实现幂等执行，避免引入额外工具链，也便于审计每条 DDL。

## 3. System Prompt 的「稳定前缀 + 动态后缀」

LLM 的 prompt cache 只有在**前缀字节级不变**时才能命中。因此：

- 稳定前缀：角色人格 / 性格 / 技能 / 命令 —— 只随角色配置变化。
- 动态后缀：当前时间 / 分层记忆 / 用户画像 —— 每轮变化，追加在末尾，成为已预热请求的「前缀扩展」。

`buildStablePrefix` 与 `buildDynamicSuffix` 分离实现，后者不会污染前者。

## 4. 分层记忆与时间感知

记忆分为日 / 三日 / 两周精简 / 月四级，逐级向上汇总，兼顾近期清晰度与长期压缩。注入优先级为「前一天日记忆 → 三日记忆 → 月记忆」，短期对话由管道直接附带。每日摘要 prompt 强制保留人、事、约定、情绪走向等关键事实。

记忆同时以结构化数据（`memories` 表）和 Markdown 文件（`MEMORY.md` / `USER.md` / `persona-state.md`）双写，便于后台查看和人工编辑。

## 5. 消息防抖、合并与打断

同一 `botId:userId` 维护一个批次：用户连续发言时重置防抖定时器，并将内容合并；若上一轮生成仍在进行，则通过 `AbortController` 取消旧任务。最终以一次 LLM 调用、一条完整消息输出，避免分段刷屏与重复回复。

## 6. LLM Provider 抽象与用量归一化

统一 `LLMProvider` 接口，OpenAI 兼容协议覆盖 DeepSeek / 自定义网关，Anthropic 单独适配（system 抽取、cache_control）。各家的缓存字段不同（OpenAI `cached_tokens`、DeepSeek `prompt_cache_hit_tokens`、Claude `cache_read_input_tokens`），在 Provider 内归一化为 `cacheHitTokens / cacheMissTokens`，统计层无需感知差异。

## 7. QQ 接入之前缀 token + WebSocket

access_token 通过带并发去重与提前 5 分钟刷新的单一入口获取，避免多请求同时刷新。事件接收选择 WebSocket 网关：无需公网回调地址，符合轻量部署目标；网关内置心跳、序列号、RECONNECT / INVALID_SESSION 处理与指数退避重连。

## 8. 敏感信息加密与脱敏

QQ ClientSecret、LLM API Key、绘画 Key 均以 AES-256-GCM 加密落库，密钥由 `ENCRYPTION_KEY` 派生。日志层对 secret 字段做 redact。API 返回永不包含明文密钥，只返回 `*Set: boolean` 标记。

## 9. 鉴权

管理后台使用「用户名 + 密码 + JWT」的轻量方案，登录同时下发 httpOnly cookie 与 token，二者任一可用。除登录与健康检查外所有接口统一挂载 `authenticate` 前置钩子。

## 10. 绘画限额与主动消息频控

绘画按「每角色每日上限 + 全局每日上限」双重校验，记录在 `painting_logs`。主动消息按用户活跃时段判断时机，单次最多 `proactiveMaxMessages` 条且用户回复后计数刷新；发送间隔加入 qps 频控。

## 11. 技能系统

内置「前任」Skill 以 prompt 片段形式入库；自定义 Skill 可自由编辑；GitHub 同步通过 Git Trees API 拉取仓库内所有 `.md` 文件，每个文件映射为一个技能，避免依赖解压库。
