# Surface brief — admin (PersonaBot 管理后台)

- Scope: 整个管理后台（`packages/admin`），路由级表面：仪表盘 / Bot 管理 / 角色管理 / 模型管理 / 记忆管理 / 统计 / 技能 / 系统设置。
- Visitor mode: Operate — 使用者在完成任务（配置角色、查看统计、管理 Bot），不是被说服或阅读。

## Audience, job, action

- 受众：单个自部署者，桌面为主，偶尔手机查看。
- 任务：把角色人格、记忆、模型与 Bot 连接配置好，然后偶尔回来查看状态与统计。
- 成功：常用操作一眼可达，角色配置显得被认真对待，深色夜间查看同样清晰。

## Chosen direction

**通告单（Greenroom Call Sheet）** — 剧组每日通告单。米白纸底 + 套红 + 场记绿，Oswald / IBM Plex Mono / 思源黑体三声部，通告单时间网格作为唯一签名动作。

## ## Direction contract

THESIS: 这个后台是一张每天开工前贴在墙上的通告单——角色、时间、状态排进严整的规则网格里；拒绝「卡片套卡片 + 紫色渐变 + 图标方块」这类 AI 默认后台的排列。

OWN-WORLD: 米白纸底 `#f4f1ea`、近黑墨 `#171512`、套红 `#c8452f`（只用于强调与活动状态）、场记绿 `#3f6b52`（成功/在线）、规则线 `#c9c2b5`；圆角几乎为零（0–4px），一切分隔靠 1px 实线规则；深色主题是「夜拍通告单」——墨底 `#14120f` + 纸色文字，套红与场记绿保持不变。字体三声部：Oswald（标题、时间、大数字）、IBM Plex Mono（编号、编码、数据）、思源黑体（中文正文与标签）。

STORY: 使用者一眼确认「今天有哪几个角色在运行、什么模型、此刻在做什么」，然后进入任意一类配置；实体 ID 像剧组编号一样可读、可对照。

FIRST VIEWPORT: 顶部为日期与工况条（日期、在线数、时区）；左侧是通告单式导航（栏目标题 + 编号，非图标堆叠）；主区第一屏是当日角色表——编号 / 角色 / 模型 / 开工时间 / 状态，下方接角色今日日程时间网格与今日统计。签名动作（日程时间网格）在首屏可见。

FORM: 通告单 / 剧组 daily call sheet；有序列表第 6 位；seed key `d19a4f2e`。

RAISES: 导航栏写成可读栏目标题 + 编号（来自 cassette j-card）；实体 ID 以等宽小字印在行首作为工业编码（来自 Saville catalog）。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
