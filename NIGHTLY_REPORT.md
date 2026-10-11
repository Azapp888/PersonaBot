# PersonaBot 夜间维护报告

日期：2026-10-11
范围：在保持既有功能不变的前提下，对仓库做系统审计、修复与增强。

## 一、发现问题（按优先级）

### P0 安全
1. **敏感设置明文泄露**：`GET /api/settings` 直接返回 `paintingApiKey` / `githubToken` 明文，任何登录用户都能读取。
2. **敏感设置未加密落库**：绘画 API Key、GitHub Token 以明文存于 `settings` 表（QQ/LLM Key 已加密，唯独这两项遗漏）。
3. **默认密钥可预测**：生产环境即使继续使用 `ADMIN_PASSWORD=changeme` 等默认值也照常启动，鉴权与加密形同虚设。
4. **CORS 反射任意来源**：`@fastify/cors` 配置 `origin: true` + `credentials: true`，任意站点均可携带凭据发起跨域请求。
5. **Cookie 鉴权实际失效**：登录下发 httpOnly cookie，但 JWT 插件未注册 cookie 解析，刷新页面后 cookie 无法用于鉴权，只能退回 localStorage token（安全性与文档描述不符）。
6. **服务器 Agent 无命令防护**：Bot 开启 Agent 后可执行任意 shell，`rm -rf /`、`mkfs`、`shutdown` 等灾难性命令没有任何拦截。

### P1 稳定性 / 工程化
7. **外部请求无超时**：QQ OpenAPI、LLM、绘画、GitHub、附件下载全部使用裸 `fetch`，上游无响应时会永久挂起请求与定时任务。
8. **无登录限流**：登录接口无速率限制，可被暴力破解。
9. **无安全响应头 / 统一错误处理**：缺少 `X-Content-Type-Options` 等；错误可能泄露堆栈。
10. **无测试 / 无 CI**：仓库没有任何自动化测试或流水线。
11. **会话 JSON 无限增长**：`conversations.messages` 只追加不裁剪，单会话历史可无限膨胀。
12. **消息打断未真正中止在途 LLM**：`AbortController` 只作为本地标记，未传递给 Provider，旧请求仍会消耗 token 并可能覆盖新回复。
13. **内存 Map 无清理**：`sentSinceReply`（主动消息计数）长期运行会持续增长。
14. **进程级异常未兜底**：未捕获异常 / 未处理 Promise 拒绝无日志。

### P2 文档 / 体验
15. README 未覆盖测试、CI、安全说明；`.env.example` 缺少 `CORS_ORIGINS`。

## 二、同类项目调研

本环境 web/MCP 搜索不可用（余额不足），以下为基于既有知识对 NoneBot2 / Koishi / AstrBot / ZeroBot 等框架设计思路的对照（仅吸收思路，未复制任何代码）：

- **NoneBot2**：插件按事件总线（驱动适配器）解耦；权限/规则用 `Rule` 与 `Permission` 组合表达；依赖注入式会话状态。→ 本项目采用 pipeline + settings 已在方向内，后续可抽出「规则链」。
- **Koishi**：配置热重载、命令前缀与中间件链、服务容器与依赖注入。→ 已具备部分（settings 热读、装饰器路由），可继续向「服务容器 / 中间件」演进。
- **AstrBot**：会话级人格 + 记忆 + 多 Provider + WebUI 管理。与本项目高度同构；其亮点是权限分级与 WebUI 一体化配置。→ 已具备鉴权与 WebUI，本轮补齐了鉴权 cookie 与限流。
- **ZeroBot / go-cqhttp 生态**：命令前缀、黑名单、限流中间件是标配。→ 本轮补上登录限流；黑名单可在后续 P2 规划。
- 普遍共识：**默认安全**（默认密钥必须拒绝启动）、**外部调用必须有超时与重试**、**插件/命令需权限与频控**。本轮 P0/P1 主要围绕这些共识落地。

## 三、已实现改动

提交 `4f73837`（P0 + 部分 P1）：
- 敏感设置改为 AES-256-GCM 加密落库；`GET /api/settings` 仅返回 `*Set` 标记，不再泄露明文。
- 生产环境检测到默认 `ADMIN_PASSWORD`/`JWT_SECRET`/`ENCRYPTION_KEY` 时拒绝启动（开发环境仅告警）。
- CORS 默认关闭，仅当配置 `CORS_ORIGINS` 白名单时开启。
- JWT 增加 cookie 解析，httpOnly cookie 鉴权真正生效；生产环境 cookie 加 `Secure`。
- 服务器 Agent 增加灾难性命令黑名单拦截。
- 登录接口按 IP 限流（15 分钟 10 次，超限 429 + Retry-After）。
- 所有外部请求统一 `fetchWithTimeout`。
- 新增基础安全响应头、统一错误处理、进程级异常兜底。
- 新增 25 例单元测试 + GitHub Actions CI。

本次追加（P1）：
- 消息打断真正传递 `AbortSignal` 到 LLM/Agent 调用，并新增 `abort-store` 兜底中止在途请求。
- Agent 循环检查中止信号、工具输出二次截断（4000 字符上限）。
- 会话历史新增 `conversationMaxMessages`（默认 400）裁剪，防止 JSON 无限增长。
- 主动消息内存计数定期清理 + 每日定时 sweep。
- `decideDaily` 互动时间改为统一时间戳比较，消除时区混用。
- 补充 `abort-store` 测试至 28 例。

## 四、测试结果

- `pnpm -r typecheck`：通过（server + admin）。
- `pnpm test`：28 passed / 0 failed。
- `pnpm build`：通过（server + admin）。
- 运行时冒烟：设置接口不再泄露明文；安全头存在；cookie 鉴权生效；登录限流触发 429；迁移与启动正常。

## 五、未完成项 / 后续建议（P2）

1. **管理员密码支持哈希存储**（当前为明文比对 env）；引入 `scrypt`/`argon2` 派生。
2. **敏感词 / 黑名单 / 群管**：QQ 生态常见能力，可作为可选模块加入。
3. **命令权限分级**：为服务器 Agent 前缀命令增加「管理员白名单用户」限制，而非仅靠 per-Bot 开关。
4. **SQLite 备份与迁移回滚脚本**：迁移已幂等但缺少自动备份。
5. **依赖安全审计**：接入 `pnpm audit` 到 CI（需网络）。
6. **前端代码分割**：admin 单 chunk 696KB，可 dynamic import 路由降体积。
7. **结构化记忆检索**：`retrieveRelevantMemories` 目前为 n-gram，可评估轻量向量方案（注意内存预算）。
8. **HTTP 层测试**：用 `fastify.inject` 补接口级测试（鉴权、限流、设置脱敏）。

## 六、风险与说明

- 敏感设置加密后，历史明文数据会在下次写入时转为密文；`decryptSecret` 保留明文兼容分支，故老数据读取不受影响。
- 命令黑名单是「防误操作」而非「安全沙箱」，无法穷尽所有危险命令；真正的隔离需容器 / 权限用户。
- 运行时服务已用新构建重启验证；数据文件位于 `data/`，未做破坏性变更。
