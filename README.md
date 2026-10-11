# PersonaBot

轻量级角色扮演 QQ Bot 管理系统。每个 QQ Bot 绑定一个角色人格（Persona），每次对话都以该角色的身份运行；人格提示词、技能插件、命令池、绘画配置全部可在管理后台配置；记忆系统采用分层总结 + 时间感知架构；支持多 Bot 独立运行。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 管理后台 | React + TypeScript + Vite + Tailwind CSS（shadcn 风格组件） |
| 后端 | Node.js + Fastify |
| 数据库 | SQLite（better-sqlite3），自带迁移 |
| 缓存 | 内存缓存 + 文件缓存（不引入 Redis） |
| 定时任务 | node-cron |
| QQ 接入 | QQ 官方机器人 API v2（HTTPS OpenAPI + WebSocket 网关） |
| AI 模型 | 统一 LLM Provider 接口（DeepSeek / OpenAI / Claude / 自定义 / Mock） |
| 部署 | 管理后台 + API 同进程挂载指定端口，支持 Docker / pm2 / systemd |

## 目录结构

```
PersonaBot/
├── package.json                 # pnpm workspace 根
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── packages/
    ├── server/                  # 后端服务
    │   └── src/
    │       ├── index.ts         # 进程入口（DB → 路由 → Bot 网关 → 定时任务）
    │       ├── app.ts           # Fastify 应用装配
    │       ├── config.ts        # 环境变量与默认配置
    │       ├── logger.ts        # Pino 日志
    │       ├── types.ts         # 全量领域类型
    │       ├── auth/            # 简单密码登录 + JWT
    │       ├── db/              # SQLite 连接、迁移、seed、仓库层
    │       │   ├── migrate.ts   # 迁移脚本（幂等）
    │       │   └── repos/       # bots / personas / models / memories ...
    │       ├── llm/             # LLM Provider 封装
    │       │   ├── openai.ts    # OpenAI 兼容（DeepSeek / 自定义）
    │       │   ├── anthropic.ts # Claude
    │       │   ├── mock.ts      # 本地联调
    │       │   └── factory.ts   # 依据角色配置解析 Provider
    │       ├── qq/              # QQ Bot 接入
    │       │   ├── token.ts     # access_token 获取与自动刷新
    │       │   ├── client.ts    # OpenAPI 消息发送 / 取网关
    │       │   ├── gateway.ts   # WebSocket 网关（心跳 / 重连 / 事件解析）
    │       │   └── manager.ts   # 多 Bot 网关管理
    │       ├── persona/prompt.ts# System Prompt 组装（稳定前缀 + 动态后缀）
    │       ├── skills/          # 技能系统 + 内置「前任」Skill + GitHub 自动更新
    │       ├── memory/          # 分层记忆：总结 / 注入 / 用户画像 / Markdown 落盘
    │       ├── painting/        # AI 绘画（按角色配置生成）
    │       ├── pipeline/        # 消息处理管道（防抖合并 / 打断取消）
    │       ├── proactive/       # 主动消息
    │       ├── stats/           # 统计聚合
    │       ├── cron/            # node-cron 定时任务
    │       └── routes/          # REST API
    └── admin/                   # 管理后台前端
        └── src/
            ├── App.tsx          # 路由 + 鉴权
            ├── components/      # Layout、UI 组件
            ├── lib/             # api 客户端 / 类型 / auth
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Stats / Skills / Settings
```

## 快速开始

```bash
# 1. 安装依赖（需要 pnpm 9+ / Node 20+）
pnpm install

# 2. 准备环境变量
cp .env.example .env
# 修改 ADMIN_PASSWORD / JWT_SECRET / ENCRYPTION_KEY

# 3. 初始化数据库（首次会自动迁移）
pnpm --filter @personabot/server migrate

# 4. 开发模式（后端 + 前端并行）
pnpm dev
# 后端 http://localhost:3000
# 前端 http://localhost:5173 （已配置 /api 反向代理）

# 5. 生产构建并启动
pnpm build
pnpm start
# 管理后台与 API 同时挂载在 http://localhost:3000
```

## 质量与测试

```bash
# 类型检查（server + admin）
pnpm -r typecheck

# 单元测试（node:test，覆盖时钟/文本拆分/状态守卫/Agent 命令拦截/限流）
pnpm test

# 构建
pnpm build
```

CI 流水线见 `.github/workflows/ci.yml`，在 push / PR 时执行 typecheck、test、build。

## 安全说明

- **默认密钥保护**：`NODE_ENV=production` 时若 `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY` 仍为默认值会拒绝启动；开发环境仅告警。
- **敏感字段加密**：QQ ClientSecret、LLM API Key、绘画 Key、GitHub Token 均以 AES-256-GCM 加密落库；接口只返回是否已配置，永不回传明文。
- **鉴权**：除登录与健康检查外所有接口都需登录态，同时支持 `Authorization: Bearer`（API）与 httpOnly cookie（浏览器刷新），cookie 在生产环境带 `Secure`。
- **登录限流**：同一 IP 15 分钟内最多 10 次登录尝试。
- **CORS 默认关闭**：同源部署无需 CORS；如需跨域，通过 `CORS_ORIGINS` 显式白名单，不允许任意来源携带凭据。
- **服务器 Agent 命令拦截**：内置灾难性命令黑名单（格式化、块设备写入、关机、递归删根、清空防火墙等），即便开启 Agent 也会拒绝执行。
- **网络超时**：所有外部请求（QQ / LLM / 绘画 / GitHub / 附件下载）均设超时，避免连接挂起与内存泄漏。

## 数据模型

| 表 | 说明 |
| --- | --- |
| `bots` | QQ Bot 实例，ClientSecret 加密存储，绑定 persona |
| `personas` | 角色人格定义包（提示词 / 性格 / 技能 / 命令池 / 绘画 / 模型配置） |
| `models` | LLM 模型配置（Provider / API Key / Base / 温度 / 最大 token） |
| `memories` | 分层记忆（daily / three_day / biweekly / monthly） |
| `conversations` | 会话历史（只追加，保证缓存前缀复用） |
| `user_profiles` | 用户习惯画像 |
| `stats` | 每日统计（Token / 缓存命中 / 图片 / 消息数） |
| `message_logs` | 消息流水（统计与记忆总结的数据来源） |
| `token_usage` | 每次调用的 Token 用量明细 |
| `painting_logs` | 绘画记录与每日限额依据 |
| `skills` | 技能插件（内置 / 自定义 / GitHub 同步） |
| `settings` | 系统键值设置 |

迁移脚本位于 `packages/server/src/db/migrate.ts`，按 id 顺序执行并记录在 `_migrations` 表，可重复安全执行。

## REST API 概览

| 分组 | 端点 |
| --- | --- |
| 鉴权 | `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me` |
| Bot | `GET/POST /api/bots`、`PUT/DELETE /api/bots/:id`、`POST /api/bots/:id/toggle|restart`、`GET /api/bots/status` |
| 角色 | `GET/POST /api/personas`、`PUT/DELETE /api/personas/:id`、`POST /api/personas/:id/simulate` |
| 模型 | `GET/POST /api/models`、`PUT/DELETE /api/models/:id`、`POST /api/models/:id/test` |
| 记忆 | `GET /api/memories`、`POST /api/memories/trigger`、`PUT/DELETE /api/memories/:id`、`GET /api/memories/files|file` |
| 统计 | `GET /api/stats/dashboard|trends|persona/:id|messages` |
| 技能 | `GET/POST /api/skills`、`PUT/DELETE /api/skills/:id`、`POST /api/skills/sync` |
| 设置 | `GET/PUT /api/settings`、`GET /api/system/info` |
| 运维 | `POST /api/system/proactive/run|daily/run|tokens/refresh|bots/reload` |

除 `login` 与 `health` 外，所有接口都需要登录态（`Authorization: Bearer <token>` 或 cookie）。

## 定时任务

| 任务 | 时间 | 说明 |
| --- | --- | --- |
| 日记忆生成 | 每天 00:00 | 整理前一天聊天记录，生成清晰日记忆 |
| 统计重置 | 每天 00:05 | 新一天统计从零开始 |
| 三日记忆 | 每 3 天 01:00 | 汇总过去 3 天日记忆 |
| 精简记忆 | 每 2 周 02:00 | 压缩两周记忆 |
| 月记忆 | 每月 1 日 03:00 | 汇总两周精简记忆 |
| Token 刷新 | 每天 04:00 | 刷新即将过期的 access_token |
| 主动消息 | 每 30 分钟 | 按用户活跃时段与角色性格发起 |
| Bot 网关同步 | 每 5 分钟 | 同步数据库中的 Bot 启停状态 |
| Skill 自动更新 | 可配置 | 从 GitHub 仓库拉取最新 Skill |

## 缓存命中率优化

1. System Prompt 前缀稳定：角色人格定义放最前，字节级不变；时间/记忆等动态内容放在末尾。
2. 同会话复用上下文前缀：同一用户与角色始终使用同一会话。
3. 最小工具集 + 只追加会话：会话历史只追加，不重写、不重总结更早轮次。
4. 自动压缩复用前缀：摘要追加到消息末尾。
5. 缓存指标追踪：统计页展示 `cacheRead / (input + cacheRead + cacheWrite)` 命中率。

## 部署

### Docker

```bash
cp .env.example .env
docker compose up -d --build
```

### pm2

```bash
pnpm build
pm2 start packages/server/dist/index.js --name personabot
```

### systemd

```ini
[Unit]
Description=PersonaBot
After=network.target

[Service]
WorkingDirectory=/opt/personabot
ExecStart=/usr/bin/node packages/server/dist/index.js
EnvironmentFile=/opt/personabot/.env
Restart=always

[Install]
WantedBy=multi-user.target
```

数据库文件位于 `data/`，日志位于 `logs/`，敏感信息统一由 `.env` 管理。

## 本地联调（无需真实凭据）

1. 在「模型管理」新建一个 `provider = mock` 的模型（或直接不配置模型，系统会自动回退到 Mock）。
2. 在「角色管理」新建角色，编辑人格提示词，点击「模拟」即可在本地与角色对话。
3. 在「记忆管理」手动触发生成日/三日/月记忆，验证分层记忆注入。
