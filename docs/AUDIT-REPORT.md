# PersonaBot 全量代码审计报告

审计日期：2026-11-21 · 范围：packages/server/src 全部（约 130 文件）、packages/admin/src 全部、根目录构建/部署配置。四个并行审查代理逐文件细读 + 关键发现人工交叉验证。

## 总评

代码整体质量较好：SQL 全参数化、鉴权覆盖完整、敏感字段加密落库、常量时间密码比较。没有可直接远程利用的注入类漏洞。主要问题集中在：**「服务器 Agent」受控 RCE 的架构风险、若干真实的逻辑 bug（已逐条核实）、复制粘贴型冗余（预计可净删数百行）**。

---

## 一、高危（建议优先处理）

| # | 位置 | 问题 |
|---|---|---|
| H1 | `server/src/agent/shell.ts:58-97` | Bot 可在宿主机执行**任意 shell 命令**（`exec`，无沙箱）。黑名单拦截极易绕过（`curl \| sh`、base64 管道、`find / -delete` 等均不在名单）。白名单为空时任何 QQ 用户可触发 → 等价于把服务器交给对话者 |
| H2 | `server/src/attachments/service.ts:69-84,116-126` + `llm/google.ts:35` | SSRF：附件/图片 URL 无域名白名单即由服务器 fetch，可探测内网/云元数据（如 169.254.169.254），结果回流给模型 |
| H3 | `server/src/qq/token.ts:48` | **已核实**：QQ token 获取失败时 `logger.error({ body: text })` 把含 `access_token` 的完整响应写入日志文件（凭证泄露到磁盘） |
| H4 | `server/src/app.ts:38` + `routes/auth.ts:12` | `trustProxy: true` 全开 + 登录限流 key 为 `request.ip`：直接暴露的服务可伪造 `X-Forwarded-For` 绕过登录限流，暴力破解不受 10 次/15 分钟限制 |
| H5 | `server/src/memory/realtime.ts:151` + `memory/service.ts:344-376` | 间接提示词注入通道：用户对话内容可被写入 MEMORY.md 并以「核心记忆（务必遵守）」注入下一轮 prompt，无转义/校验 |

## 二、功能性 Bug（已核实部分标注 ✅）

### 后端
1. ✅ `routes/settings.ts:24` — `rescheduleSkillUpdate()` 在 `settingsService.update()` **之前**调用，新 cron 值永远不生效（本次保存用旧值重排）
2. `db/repos/memories.ts:105-118` — `upsert` 按 (persona,user,type,source_date) 匹配即覆盖 content，同日多条「原子事实」会互相覆盖成一条，与 `listFactsByDate` 的设计冲突
3. `updater/service.ts:188-196` — 本地版本回退到 semver 时与 commit sha 比较，**永远误报有更新**
4. `cron/scheduler.ts:130` — `0 1 */3 * *` 跨月间隔不固定（二月 28 日跑完次日即再跑），与「每 3 天」语义不符
5. `cron/scheduler.ts:81,88` — 非空断言在角色被删除后会崩溃
6. `routes/bots.ts:43` — `bot.enabled ? "stopped" : "stopped"` 三元两分支相同（死代码，禁用与停止无法区分）
7. `db/repos/models.ts:75-99` + `routes/models.ts:459` — API Key **一旦写入无法清除**（null/空串被吞掉）
8. `routes/search.ts:42` — 重复添加已存在厂商时 `enabled ?? true` 会把已禁用配置静默重新启用
9. `agent/index.ts:146` — 工具循环耗尽后静默返回空内容
10. `skills/manager.ts:92` — 私有仓库 raw 下载不带 token，同步必失败
11. `qq/gateway.ts:97` — �连接复用旧 token，过期后 WebSocket 路径无 401 重取机制；`qq/client.ts:119` uploadFile 同样没有 401 重试
12. `qq/client.ts:115` — base64 上传硬编码 `image/png`，JPEG/WebP 可能被 QQ 拒收
13. `db/repos/logs.ts:130` — `invalidateByContent` 用精确匹配，同消息出现多次或内容被规范化时漏标记
14. `db/index.ts:17` — `foreign_keys=ON` 无实际作用（schema 无外键），删角色后 memory_files/user_identities 等表残留孤儿数据
15. `index.ts:70` — `uncaughtException` 只打日志不退出，进程可能带伤运行继续写 SQLite

### 前端
16. `pages/Logs.tsx:142-151` — reset() 漏掉 `validity`，重置后该筛选仍生效（平行状态设计的直接恶果）
17. 全局无请求取消/序号保护 — 快速切换筛选/翻页时慢请求返回覆盖新数据；Bots 页 10 秒轮询与用户操作交错
18. `pages/Personas.tsx:119-136` — 模拟对话流无 AbortSignal，关弹窗后仍在写状态，连续点发送产生并发流互相覆盖
19. `pages/Settings.tsx:295` — `tick + serverOffset ? ... : ""` 恒真（误导性显示）；数字输入无校验可存 0/负值（Bots.tsx:337 同）
20. 多处 `api.xxx().then(...)` 无 catch（Skills.tsx:59-68、Memories.tsx:88-94、Settings.tsx:304 等），失败静默无提示
21. `pages/Conversations.tsx:79-99` — 快速切换用户后立刻删除，index 是旧会话的、身份是新会话的，可能删错消息

## 三、安全问题（次级）

- `utils/crypto.ts:31` — 解密失败静默返回原文，密文/明文混淆无告警
- `config.ts:37-39` — ENCRYPTION_KEY 仅 SHA-256 派生，无盐无 KDF；默认 key 下 DB 拷走即得全部凭据
- `routes/auth.ts:39` + 前端 `lib/api.ts:38-46` — token 同时走 httpOnly cookie 与 localStorage 双通道，JWT 存 localStorage 使 XSS 可盗取长期凭据
- `updater/service.ts:330,342` — settings 的 branch 未校验直接拼进 exec 命令（需管理员权限前置，命令注入）
- `updater/service.ts` 整体 — 远程自更新 = 供应链风险，建议改手动确认
- `app.ts:71` — 4xx 原样回显 error.message，可能泄露内部 apiBase/上游细节
- `pages/Login.tsx:77` — 登录页明文提示凭据存放位置
- `Dockerfile:7,20` — `--frozen-lockfile=false` 破坏锁定；运行镜像带全部 devDependencies 且以 root 运行、无 HEALTHCHECK

## 四、冗余实现 / 绕远路的地方（可直接简化）

**复制粘贴（可直接删数百行）**
1. `extractJson` 逐字符相同的三份拷贝（memory/importer.ts:44-58、realtime.ts:88-102、schedule.ts:30-44）+ profile.ts:62 的第四份弱实现 → 抽到 utils/json.ts
2. `DEFAULT_BASES` 三份重复（llm/factory.ts:13-32、llm/discover.ts:19-35、provider-classify.ts:57-73）→ 单一厂商元数据表派生
3. routes/models.ts 两段 discover 端点（252-283 vs 329-360）几乎逐行相同 → 抽 `doDiscover()`
4. routes/logs.ts 三对孪生函数（presentRows/parseFilter/toMarkdown 各两套）→ 泛化后文件可缩一半
5. 17 个 repo 逐字重复 `db(){ return getDb(); }` 样板（约 51 行）
6. 前端 api.ts exportLogs/exportEventLogs 逐字重复 → `downloadFile(path, name)`
7. persona/prompt.ts:187-220 两分支主体重复 20 行；`void persona` 等历史残留签名可清理

**绕了大圈、可直接实现的**
- `db/repos/context.ts:45-75` 手写 read-then-write upsert，而同仓库 memoryFiles/settings 已用原生 `ON CONFLICT DO UPDATE` 一条搞定
- `db/repos/bots.ts:95-135`、`models.ts:75-99` 逐字段手工 merge 几十行样板，memories.ts 的 `updateMeta` 动态 SET 写法才是对的
- `db/repos/conversations.ts:82-90` 函数体内 `require()` 打破循环依赖 —— 分层问题打补丁，上限应作为参数传入
- `pipeline/message-pipeline.ts` generateReply 510 行单函数混合绘画/流式/护栏/质量闸；护栏重试与质量闸重试两段逐行重复 → 提取 retryOnce()
- `pages/Logs.tsx` 两套筛选+两套 page 状态 → 单对象 + tab 枚举，reset 漏字段 bug 自然消失
- `pages/Personas.tsx:75` `JSON.parse(JSON.stringify(p))` → `structuredClone(p)`
- `pages/Settings.tsx` 800 行 20+ useState 平铺 → 按区块拆子组件
- 主动消息「活跃时段判断」两处实现且都未处理跨零点窗口

## 五、修复优先级建议

1. **P0**：H3（日志泄 token，一行改动）、H4（trustProxy 收窄）、二.1（reschedule 顺序，一行改动）、H2（下载 URL 私网黑名单）
2. **P1**：H1（Agent shell 收紧白名单/沙箱）、二.2（memory upsert）、二.7（key 不可删除）、二.16-18（前端竞态）
3. **P2**：全部冗余合并（净删数百行、降低未来 bug 率）、docker 生产镜像瘦身

> 报告由四个并行只读审查代理产出，高危/主要 bug 结论经人工读码核实（标 ✅ 者为逐行确认）。未修改任何项目文件。
