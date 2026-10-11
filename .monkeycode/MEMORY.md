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
