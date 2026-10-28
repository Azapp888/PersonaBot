# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[User Instruction Summary]
- Date: 2026-10-12
- Context: User wants every change pushed without being asked
- Instructions:
  - 每次完成改动后，Agent 需自动 commit 并 push 到远程 main（用户明确要求，无需再询问）。
  - 提交前仍要跑通 typecheck / test / build。
  - 破坏性操作（reset --hard / force push / 删分支）仍不得代跑。

[User Instruction Summary]
- Date: 2026-10-12
- Context: User was rolling back the nightly-maintenance work and set a new baseline
- Instructions:
  - 基线提交确定为 `8386a0b`（"feat(memory): 记忆文件支持 AI 追加且不改动用户原文"）。
  - 以后所有修改都以该提交为起点进行。
  - 用户将手动执行 `git reset --hard 8386a0b` + `git push --force-with-lease origin main` 废弃其后的提交（含 `2245ea6` OpenClaw 接入）；Agent 不得代跑删除/强推等破坏性操作。

[Project Knowledge Summary]
- Date: 2026-10-10
- Context: Discovered by Agent while rebuilding and restarting PersonaBot after feature work
- Category: Operations & Deployment
- Instructions:
  - 本项目为标准 pnpm workspace，位于 /workspace。
  - 构建全部：`pnpm build`（会先 tsc 再 vite build，server 构建后 copy-assets 复制 skills）。
  - 类型检查（lint 等价物）：`pnpm -r typecheck`（server/admin 都是 tsc --noEmit）。
  - 生产运行：`node packages/server/dist/index.js`，监听 0.0.0.0:3000，同时托管 packages/admin/dist 前端。
  - 改动 admin 或 server 源码后，必须 `pnpm build` 再重启服务，运行的是 dist 而非源码。
  - 编译/构建类命令需用 background_terminal_create 执行（见资源限制规则）。

[Project Knowledge Summary]
- Date: 2026-10-10
- Context: Discovered by Agent while debugging "主动消息不发送"
- Category: Troubleshooting & Debugging
- Instructions:
  - 主动消息不发送的常见根因：角色未绑定「已启用的 Bot」（persona 有 personaId 但 bot.personaId 不匹配或 bot 未启用）。
  - 排查入口：`POST /api/system/proactive/run` 现在返回结构化诊断（personas/profiles/sent/details/skipped/errors），skipped 会给出每个目标的具体跳过原因。
  - 从 dist 运行的服务，登录接口 `POST /api/auth/login`（admin/changeme，取自 .env 的 ADMIN_USERNAME/ADMIN_PASSWORD）返回的 token 用于 Bearer 鉴权；用 cookie 有时会 401，排查脚本优先用 Bearer token。

[Project Knowledge Summary]
- Date: 2026-10-11
- Context: Discovered by Agent while auditing/adding tests to PersonaBot
- Category: Testing Methods
- Instructions:
  - 单元测试：`pnpm test`（根目录）或 `pnpm --filter @personabot/server test`；基于 node:test + tsx，测试文件在 packages/server/test/*.test.ts。
  - 测试覆盖纯逻辑模块（clock/text/context.state/agent.shell/rateLimit/abort-store），不依赖 DB/网络。
  - packages/server/tsconfig.json 已 exclude test 目录，避免测试文件进入 dist 构建。
  - CI 在 .github/workflows/ci.yml，依次执行 typecheck → test → build。

[Project Knowledge Summary]
- Date: 2026-10-11
- Context: Discovered by Agent while hardening security
- Category: Environment Configuration
- Instructions:
  - NODE_ENV=production 时若 ADMIN_PASSWORD/JWT_SECRET/ENCRYPTION_KEY 仍为默认值，进程会拒绝启动；开发环境仅告警。
  - 敏感设置（paintingApiKey/githubToken）现由 settingsService 用 AES-256-GCM 加密落库，GET /api/settings 只返回 *Set 布尔标记。
  - CORS 默认关闭；需要跨域时通过 CORS_ORIGINS（逗号分隔白名单）显式开启。
  - 登录接口按 IP 限流：15 分钟 10 次，超限返回 429。服务器 Agent 前置灾难性命令黑名单拦截。

[Project Knowledge Summary]
- Date: 2026-10-14
- Context: Discovered by Agent while deploying preview and running dev servers
- Category: Operations & Deployment
- Instructions:
  - 开发预览时，后端以 `tsx watch src/index.ts` 运行（支持改动自动重载，无需手动重启）；前端为 Vite dev server（5173，host 0.0.0.0，`/api` 反代到 3000，allowedHosts 含 `.monkeycode-ai.online`）。
  - 预览端口用 5173（前端）；后端 3000 只提供 API（dev 下不托管 admin dist）。
  - 修改 server 路由后，可用 `curl -o /dev/null -w "%{http_code}"` 对比新路由（401=已注册且需鉴权）与不存在路径（404）判断是否已热重载。

[Project Knowledge Summary]
- Date: 2026-10-14
- Category: Environment Configuration
- Context: Discovered by Agent while implementing provider classification by baseURL
- Instructions:
  - models.dev 模型元数据目录地址：https://models.dev/api.json（可用环境变量 MODELS_DEV_URL 覆盖），模型带 `attachment` 与 `modalities.input` 字段，是判定「读图能力」的权威依据。
  - 提供商分类的事实单元是归一化后的 apiBase（host+path），不是固定枚举 provider；同地址不同密钥视为同一提供商的多个凭据。

[Project Knowledge Summary]
- Date: 2026-10-28
- Context: Discovered by Agent while implementing P0 latency and streaming fixes
- Category: Environment Configuration
- Instructions:
  - 闲聊思考默认关闭；`CHAT_THINKING=on` 恢复上游思考，`CHAT_THINKING_PARAM=thinking_budget` 适配旧版 GLM 的关闭参数。
  - 场景路由默认关闭；`CHAT_MODEL_ROUTING=on` 且配置 `CHAT_LOW_LATENCY_MODEL_ID` / `CHAT_REASONING_MODEL_ID` 时，按场景把指定模型提到候选链首位。
  - 模型熔断阈值与冷却可用 `LLM_CIRCUIT_FAILURES` / `LLM_CIRCUIT_COOLDOWN_MS` 调整。
  - 后台模拟流式接口：`POST /api/personas/:id/simulate/stream`（SSE，事件 delta / first-bubble / done / stop）。
