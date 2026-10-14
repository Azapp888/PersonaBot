# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

单个自部署者 / 运维者，主要在自己的电脑上使用管理后台（桌面为主）。他同时是产品作者、管理员与唯一使用者；偶尔会在手机上快速查看 Bot 状态或开关。他熟悉技术，但希望后台是「配置一次、平时信任」的内部工具，而不是需要学习的复杂系统。

## Product Purpose

PersonaBot 是一个轻量级、自托管的角色扮演 QQ Bot 管理系统。它让使用者创建携带完整人格的角色（Persona），把每个 QQ Bot 绑定到角色，并以该角色身份持续对话。后台负责配置人格提示词、技能、记忆、模型与 Bot 连接。成功意味着：角色长期保持可信的人格一致性，记忆随时间自然累积，使用者只需偶尔回来调整配置。

## Positioning

这是一台「拟人化角色扮演引擎」，而非常规聊天机器人面板。差异来自三层记忆（日/三日/两周/月，逐级汇总）、时间感知（角色知道「现在几点、自己在做什么」，并有每日日程）、以及「稳定前缀 + 动态后缀」的提示词架构。同类面板通常只提供提示词编辑与会话记录。

## Operating Context

- 部署：管理后台与 REST API 同进程挂载单一端口，Docker / pm2 / systemd 均可。
- 日常动作：查看仪表盘统计（Token 消耗、缓存命中率）、编辑角色人格与日程、管理模型与 Bot 连接、查看/编辑记忆、调整系统设置。
- 使用节奏：配置完成后长期后台运行；使用者在需要时回来查看或微调，而非持续盯着屏幕。
- 技术环境：桌面浏览器，深色与浅色主题都会用到（夜间查看是真实场景）。

## Capabilities and Constraints

- 前端：React + TypeScript + Vite + Tailwind CSS。
- 后端：Node.js + Fastify + SQLite（better-sqlite3，不引入 Redis）。
- 模型：统一 LLM Provider（OpenAI 兼容 / DeepSeek / Anthropic Claude / 火山引擎方舟 / 自定义 / Mock）；模型按 Bot 分配。
- 记忆：结构化表 + Markdown 文件双写，支持人工编辑。
- 敏感字段（ClientSecret / API Key）加密落库，API 永不返回明文。
- 约束：保持单端口部署、无外部服务依赖（不引入设计相关的运行时服务）；中文界面。

## Evidence on Hand

- 现有代码：`packages/admin`（React 管理后台）、`packages/server`（Fastify 后端）。
- 现有设计：`docs/DESIGN.md` 记录架构决策，含「模型按 Bot 分配」等；无独立视觉设计系统文档。
- 真实数据模型：Bot、Persona（含 `scheduleTemplate`）、Model、Memory、Skill、Settings、Stats。
- 无品牌资产：无 logo、无固定品牌色、无对外营销材料。不可编造客户、基准或商业声明。

## Product Principles

1. 角色可信度优先：任何界面元素都不应让人格配置显得轻浮或临时。
2. 配置一次即信任：常用操作一眼可达，危险操作需明确意图。
3. 记忆是产品核心：记忆与日程的呈现要与「角色在生活」这一事实相称。
4. 桌面密度：允许信息密集的表格与面板，面向熟悉技术的单人用户。
5. 单端口、零外部依赖：设计不得要求额外的后端服务。

## Accessibility & Inclusion

- 深色与浅色主题都需达到 WCAG AA 文本对比度（正文 ≥4.5:1，大字 ≥3:1）。
- 中文界面，需为中文正文选择合适的字体与行高。
