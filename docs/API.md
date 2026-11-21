# PersonaBot 开放 API

外部应用可以通过开放 API 调用 PersonaBot：每条 API Key 绑定**一个角色 + 一个用户**，调用方无需也无法指定身份，服务端据此决定「用哪个角色、以谁的身份对话」。

一台服务器可以服务多个用户：不同用户之间的会话、记忆、状态完全隔离（会话与记忆都以 `userId` 为主键维度存储）。

## 1. 开通步骤

1. 在管理后台「角色管理」中创建角色；
2. 进入「开放 API」页，在**用户管理**中创建用户（`externalId` 由你定义，如微信 openid）；
3. 在**API 密钥**区选择角色与用户，点击「签发密钥」；
4. 密钥明文只显示一次，请立即保存。数据库中只保存 SHA-256 散列。

## 2. 认证

请求头二选一：

```http
Authorization: Bearer pb_xxxxxxxxxxxxxxxx
```

```http
X-API-Key: pb_xxxxxxxxxxxxxxxx
```

- 密钥停用或绑定用户被停用时返回 `401 / 403`；
- 按密钥限流，默认 60 次/分钟，可通过环境变量 `OPEN_API_RATE_LIMIT` 调整，超限返回 `429` 并带 `Retry-After`。

## 3. 接口

### GET /api/v1/me

返回当前密钥的绑定信息，用于接入方自检。

```json
{
  "keyName": "微信小程序",
  "persona": { "id": "per_xxx", "name": "小明" },
  "user": { "id": "wx_openid_123", "displayName": "张三", "enabled": true }
}
```

### GET /api/v1/persona

返回绑定角色的公开信息（名称与简介，不含提示词等内部配置）。

```json
{ "id": "per_xxx", "name": "小明", "description": "..." }
```

### POST /api/v1/chat

一次性对话，返回完整回复。

请求：

```json
{ "message": "今天有点累" }
```

- `message` 必填，长度上限 4000 字符。

响应：

```json
{
  "reply": "那就早点休息吧，我陪你聊会儿。",
  "modelId": "mod_xxx",
  "usage": { "inputTokens": 1200, "outputTokens": 80, "cacheHitTokens": 900, "cacheMissTokens": 300 }
}
```

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Authorization: Bearer pb_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"今天有点累"}'
```

### POST /api/v1/chat/stream

流式对话（Server-Sent Events），逐块下发。客户端断开时服务端会中止在途生成，避免继续消耗 token。

```bash
curl -N -X POST http://localhost:3000/api/v1/chat/stream \
  -H "Authorization: Bearer pb_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"message":"讲个故事"}'
```

事件流（每行 `data: <json>`）：

```
data: {"type":"first-bubble","text":"从前...","atMs":320}
data: {"type":"delta","text":"从前...","delta":"从前","ttftMs":320}
data: {"type":"done","reply":"从前有座山..."}
data: {"type":"usage","usage":{...},"modelId":"mod_xxx"}
```

### GET /api/v1/conversation

读取当前绑定用户的会话历史。

| 参数 | 说明 |
| --- | --- |
| `limit` | 返回最近多少条，默认 20，最大 200 |

```json
{ "total": 42, "messages": [{ "role": "user", "content": "你好", "timestamp": 1763700000000 }] }
```

### POST /api/v1/conversation/reset

清空当前绑定用户的会话原文（**记忆不受影响**）。

```json
{ "ok": true }
```

## 4. 多用户部署

- 每个用户一行记录（`app_users`），`externalId` 就是会话与记忆系统中的 `userId`；
- 每个用户可绑定多条密钥（例如一个用户在小程序、公众号各一条）；
- 一个角色可以被多个用户共享，也可以为不同用户配置不同角色；
- 用户被停用后，其所有密钥立即失效（`403`）。

## 5. 费用控制

开放 API 与 QQ 通道共用每日 token 预算闸门（设置 → 成本预算）：

- 预算用尽且策略为 `block`：返回本地兜底回复，不调用模型；
- 策略为 `degrade`：切换到指定降级模型继续对话；
- 预算为 0 表示不限制。

每日用量可在仪表盘「今日成本预算」查看。

## 6. 安全说明

- 密钥仅存散列，泄露面最小化；
- 密钥绑定关系写入数据库，改绑/停用即时生效；
- 服务端对每个请求记录系统日志（分类 `system`），可在「日志」页筛选；
- 生产环境请通过 HTTPS 反向代理访问，避免密钥在传输中泄露。
