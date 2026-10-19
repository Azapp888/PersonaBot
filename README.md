# PersonaBot

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

轻量级角色扮演 QQ Bot 管理系统。每个 QQ Bot 绑定一个角色人格（Persona），每次对话都以该角色的身份运行；人格提示词、技能插件、命令池、绘画配置全部可在管理后台配置；记忆系统采用分层总结 + 时间感知架构；支持多 Bot 独立运行。

当前版本同时具备：

- **提供商级模型管理**：按提供商卡片统一配置名称 / Base URL / 密钥，一键检测拉取可用模型，支持多模态能力扫描与真实品牌图标；
- **图片与文件理解**：支持 QQ 图片、附件输入，主模型不支持读图时自动改由视觉副模型转述后重试；
- **完整日志体系**：消息日志记录「说了什么」，运行日志记录「做了什么、耗时、为何失败」，支持筛选、分页与 JSON / Markdown 导出；
- **分层记忆与会话治理**：滚动摘要 + 滑动窗口 + 核心记忆 + 增量注入，配合会话超时迁移与状态护栏。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 管理后台 | React + TypeScript + Vite + Tailwind CSS（shadcn 风格组件） |
| 后端 | Node.js + Fastify |
| 数据库 | SQLite（better-sqlite3），自带迁移 |
| 缓存 | 内存缓存 + 文件缓存（不引入 Redis） |
| 定时任务 | node-cron |
| QQ 接入 | QQ 官方机器人 API v2（HTTPS OpenAPI + WebSocket 网关） |
| AI 模型 | 统一 LLM Provider 接口（OpenAI 兼容 / Anthropic / Google / 自定义 / Mock），内置提供商预设与模型自动检测 |
| 多模态 | 图片直传与视觉副模型降级（主模型拒绝图片时自动转述后重试） |
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
    │       ├── logging.ts       # 运行日志双写入口（DB + Pino）
    │       ├── types.ts         # 全量领域类型
    │       ├── auth/            # 简单密码登录 + JWT
    │       ├── db/              # SQLite 连接、迁移、seed、仓库层
    │       │   ├── migrate.ts   # 迁移脚本（幂等）
    │       │   └── repos/       # bots / personas / models / providers / memories / system-logs ...
    │       ├── llm/             # LLM Provider 封装
    │       │   ├── openai.ts    # OpenAI 兼容（DeepSeek / 自定义）
    │       │   ├── anthropic.ts # Claude
    │       │   ├── google.ts    # Gemini
    │       │   ├── mock.ts      # 本地联调
    │       │   ├── discover.ts  # 提供商模型自动检测
    │       │   ├── vision*.ts   # 读图判定 / 扫描 / 转述降级
    │       │   └── factory.ts   # 依据角色 / Bot 配置解析 Provider
    │       ├── qq/              # QQ Bot 接入
    │       │   ├── token.ts     # access_token 获取与自动刷新
    │       │   ├── client.ts    # OpenAPI 消息发送 / 取网关
    │       │   ├── gateway.ts   # WebSocket 网关（心跳 / 重连 / 事件解析）
    │       │   └── manager.ts   # 多 Bot 网关管理
    │       ├── attachments/     # 图片 / 文件附件处理
    │       ├── moderation/      # 敏感词过滤（可选）
    │       ├── context/         # 滑动窗口 / 滚动摘要 / 状态机 / 护栏
    │       ├── persona/prompt.ts# System Prompt 组装（稳定前缀 + 动态后缀）
    │       ├── skills/          # 技能系统 + 内置「前任」Skill + GitHub 自动更新
    │       ├── memory/          # 分层记忆：总结 / 注入 / 用户画像 / 实时事实 / 日程 / Markdown 落盘
    │       ├── painting/        # AI 绘画（按角色配置生成）
    │       ├── pipeline/        # 消息处理管道（防抖合并 / 打断取消 / 失败重试）
    │       ├── proactive/       # 主动消息
    │       ├── stats/           # 统计聚合
    │       ├── cron/            # node-cron 定时任务
    │       └── routes/          # REST API
    └── admin/                   # 管理后台前端
        └── src/
            ├── App.tsx          # 路由 + 鉴权
            ├── assets/providers/# 内置品牌 SVG 图标
            ├── components/      # Layout、UI 组件、ModelIcon
            ├── lib/             # api 客户端 / 类型 / auth
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Logs / Stats / Skills / Settings
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

### 前端代码分割

管理后台按路由懒加载各页面（React.lazy + Suspense），图表等重依赖独立分包，
首屏主包从约 700KB 降至约 215KB（gzip 约 69KB）。

## 模型管理与多模态

「模型管理」以**提供商卡片**为首页，提供商级配置（名称 / API Base / 密钥）统一维护并级联到其下所有模型，模型本身只保存 `modelId`、显示名、温度、最大 token、读图开关与启用状态。

- **新增提供商**：可先建空提供商（暂无模型），之后再补充模型；密钥留空时沿用已保存密钥。
- **自动识别**：按填写或选择的提供商名称匹配品牌图标与预设（含 OpenAI / Claude / Gemini / DeepSeek / 通义 / 智谱 / Moonshot / 火山 / 混元 等），图标为内置真实品牌 SVG。
- **检测拉取**：调用上游 `/models` 自动发现可用模型并批量加入；也支持手动添加或移除单个模型。
- **连通性测试**：对单个模型发送最小请求，返回回复内容与 token 用量。
- **读图能力扫描**：结合命名规则与实测（可持久化）判定模型是否支持图片输入。

多模态输入流程：QQ 图片 / 文件先经附件处理模块归一化；主模型支持读图时直接随消息发送，不支持时自动改由视觉副模型转述为文本后重试同一次请求。图片大小与尺寸限制按提供商分别适配。

## 日志体系

「日志」页分为两个 Tab，数据来源互相独立：

| 类型 | 记录内容 | 用途 |
| --- | --- | --- |
| 消息日志（`message_logs`） | 收发的对话正文、方向、角色、Bot、用户 | 回顾「说了什么」，也是统计与记忆总结的数据来源 |
| 运行日志（`system_logs`） | 级别、类别、阶段、耗时、结构化明细 | 排查「做了什么、耗时多久、为什么失败」 |

运行日志覆盖：

- 回复生成开始与结束（角色、提供商、模型、历史条数、是否含图片、用户输入）；
- 每次模型请求与响应（`apiBase`、温度、最大 token、消息条数、字符数、耗时、usage）；
- 上游拒绝图片输入后的视觉降级重试；
- 状态护栏命中后带强制指令重试；
- 连通性测试、模型检测、读图扫描；
- 生成失败的错误名、消息与堆栈。

两类日志均支持按角色、用户、关键字与时间范围筛选，分页浏览并导出 JSON / Markdown；消息日志另有方向筛选，运行日志另有级别与类别筛选。用户筛选从已有日志聚合为下拉选项。

## 记忆与会话

- **分层记忆**：日 / 三日 / 两周 / 月记忆逐层浓缩，配合用户画像与原子事实。
- **核心记忆**：达到重要性阈值的约定 / 偏好 / 事实进入受保护区，独立注入，不随文件编辑丢失。
- **相关记忆检索**：按当前输入与待办话题检索片段，避免全量注入。
- **记忆文件增量注入**：内容与上一轮一致时只注入占位提示，减少重复 Token。
- **实时事实**：对话中命中约定 / 偏好 / 重要信息立即写入长期记忆，下一轮即可生效。
- **会话治理**：滑动窗口保留最近 N 轮原文，更早对话滚动摘要；会话超时后先把长期记忆点迁移到核心记忆再开启新会话，避免记忆随缓存丢失。
- **状态护栏**：作业未完成等场景下拦截并重试催睡类回复。

## 敏感词过滤（可选）

在「系统设置 → 敏感词过滤」中开启，词表按行 / 逗号 / 分号分隔。命中用户消息后：

- **拦截**：不进入模型，回复固定提示；
- **替换为 \***：命中词替换为等长星号后继续对话。

默认关闭，定位为基础运营过滤，并非内容审查。

## 记忆文件 AI 追加（可选）

三个记忆文件（`MEMORY.md` / `USER.md` / `persona-state.md`）在用户手动编辑后默认不再被自动覆盖。若希望 AI 继续累积记忆又不破坏用户原文：

1. 在「系统设置 → 记忆文件 AI 追加」打开全局开关；
2. 在「记忆」页选中文件，对已手动编辑的文件打开「允许 AI 追加」。

开启后，每日记忆生成时会把当天新内容追加到文件末尾的 `<!-- AI:APPEND -->` 追加区：

- 用户原文（标记之前）永不被修改；
- 追加内容按行去重，重复内容不会再次写入；
- 关闭文件级开关即停止追加，原文与已追加内容仍保留。

## 质量与测试

```bash
# 类型检查（server + admin）
pnpm -r typecheck

# 单元测试（node:test，覆盖时钟/文本拆分/状态守卫/敏感词过滤/上下文与记忆/提供商配置/运行日志/限流）
pnpm test

# 构建
pnpm build
```

CI 流水线见 `.github/workflows/ci.yml`，在 push / PR 时执行 typecheck、test、build。

## 安全说明

- **默认密钥保护**：`NODE_ENV=production` 时若 `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY` 仍为默认值会拒绝启动；开发环境仅告警。
- **管理员密码哈希（可选）**：设置 `ADMIN_PASSWORD_HASH`（`scrypt$salt$hash`）后优先于明文密码校验，登录比较为常量时间。生成命令：

```bash
node packages/server/dist/scripts/hash-password.js "你的密码"
```

- **敏感字段加密**：QQ ClientSecret、LLM API Key、绘画 Key、GitHub Token 均以 AES-256-GCM 加密落库；接口只返回是否已配置，永不回传明文。
- **鉴权**：除登录与健康检查外所有接口都需登录态，同时支持 `Authorization: Bearer`（API）与 httpOnly cookie（浏览器刷新），cookie 在生产环境带 `Secure`。
- **登录限流**：同一 IP 15 分钟内最多 10 次登录尝试。
- **CORS 默认关闭**：同源部署无需 CORS；如需跨域，通过 `CORS_ORIGINS` 显式白名单，不允许任意来源携带凭据。
- **服务器 Agent 命令拦截**：内置灾难性命令黑名单（格式化、块设备写入、关机、递归删根、清空防火墙等），即便开启 Agent 也会拒绝执行。
- **网络超时**：所有外部请求（QQ / LLM / 绘画 / GitHub / 附件下载）均设超时，避免连接挂起与内存泄漏。
- **日志脱敏**：Pino 日志对 `clientSecret` / `apiKey` / `password` 等字段做 redact；运行日志记录请求元信息、耗时与错误原因，为便于排障可能包含对话内容片段。

## 数据备份

SQLite 使用 `VACUUM INTO` 生成一致性在线快照（无需停机），默认保留最近 10 份，存放在 `data/backups/`：

```bash
# 备份并保留最近 10 份
pnpm --filter @personabot/server backup

# 自定义保留份数
node packages/server/dist/scripts/backup.js 20
```

## 数据模型

| 表 | 说明 |
| --- | --- |
| `bots` | QQ Bot 实例，ClientSecret 加密存储，绑定 persona |
| `personas` | 角色人格定义包（提示词 / 性格 / 技能 / 命令池 / 绘画 / 模型配置） |
| `models` | LLM 模型配置（Provider / API Key / Base / 温度 / 最大 token / 读图 / 启用） |
| `providers` | 提供商级配置（名称 / Base / 加密密钥），支持暂无模型的空提供商 |
| `memories` | 分层记忆（daily / three_day / biweekly / monthly） |
| `conversations` | 会话历史（只追加，保证缓存前缀复用） |
| `user_profiles` | 用户习惯画像 |
| `stats` | 每日统计（Token / 缓存命中 / 图片 / 消息数） |
| `message_logs` | 消息流水（统计与记忆总结的数据来源） |
| `system_logs` | 运行日志（级别 / 类别 / 阶段 / 耗时 / 结构化明细，含索引） |
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
| 模型 | `GET/POST /api/models`、`POST /api/models/batch`、`PUT/DELETE /api/models/:id`、`POST /api/models/:id/test|discover`、`POST /api/models/discover`、`POST /api/models/vision-scan` |
| 提供商 | `GET /api/models/providers`、`POST/PUT/DELETE /api/models/providers`、`POST /api/models/providers/discover` |
| 记忆 | `GET /api/memories`、`GET /api/memories/users`、`POST /api/memories/trigger|import`、`PUT/DELETE /api/memories/:id`、`GET/PUT /api/memories/file(s)`、`POST /api/memories/file/reset`、`PUT /api/memories/file/append` |
| 日志 | `GET /api/logs`、`GET /api/logs/users`、`GET /api/logs/export`、`GET /api/logs/events`、`GET /api/logs/events/export` |
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
| 每日问候 | 每 15 分钟 | 命中用户活跃时段且当天未发时发送 |
| 内存清理 | 每天 04:30 | 清理主动消息内存计数 |
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

1. 在「模型管理」新建一个提供商卡片（`provider = mock`，或留空直接不配置模型，系统会自动回退到 Mock），再按需添加模型。
2. 在「角色管理」新建角色，编辑人格提示词，点击「模拟」即可在本地与角色对话。
3. 在「记忆管理」手动触发生成日/三日/月记忆，验证分层记忆注入。
