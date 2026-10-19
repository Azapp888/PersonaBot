# PersonaBot

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

輕量級角色扮演 QQ Bot 管理系統。每個 QQ Bot 綁定一個角色人格（Persona），每次對話都以該角色的身份運行；人格提示詞、技能外掛、指令池、繪畫設定全部可在管理後台設定；記憶系統採用分層總結 + 時間感知架構；支援多 Bot 獨立運行。

目前版本同時具備：

- **供應商級模型管理**：依供應商卡片統一設定名稱 / Base URL / 金鑰，一鍵偵測並拉取可用模型，支援多模態能力掃描與真實品牌圖示；
- **圖片與檔案理解**：支援 QQ 圖片、附件輸入，主模型不支援讀圖時自動改由視覺副模型轉述後重試；
- **完整日誌體系**：訊息日誌記錄「說了什麼」，運行日誌記錄「做了什麼、耗時、為何失敗」，支援篩選、分頁與 JSON / Markdown 匯出；
- **分層記憶與會話治理**：滾動摘要 + 滑動視窗 + 核心記憶 + 增量注入，配合會話逾時遷移與狀態護欄。

## 技術棧

| 層 | 選型 |
| --- | --- |
| 管理後台 | React + TypeScript + Vite + Tailwind CSS（shadcn 風格元件） |
| 後端 | Node.js + Fastify |
| 資料庫 | SQLite（better-sqlite3），內建遷移 |
| 快取 | 記憶體快取 + 檔案快取（不引入 Redis） |
| 定時任務 | node-cron |
| QQ 接入 | QQ 官方機器人 API v2（HTTPS OpenAPI + WebSocket 閘道） |
| AI 模型 | 統一 LLM Provider 介面（OpenAI 相容 / Anthropic / Google / 自訂 / Mock），內建供應商預設與模型自動偵測 |
| 多模態 | 圖片直傳與視覺副模型降級（主模型拒絕圖片時自動轉述後重試） |
| 部署 | 管理後台 + API 同程序掛載指定連接埠，支援 Docker / pm2 / systemd |

## 目錄結構

```
PersonaBot/
├── package.json                 # pnpm workspace 根
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── packages/
    ├── server/                  # 後端服務
    │   └── src/
    │       ├── index.ts         # 程序入口（DB → 路由 → Bot 閘道 → 定時任務）
    │       ├── app.ts           # Fastify 應用裝配
    │       ├── config.ts        # 環境變數與預設設定
    │       ├── logger.ts        # Pino 日誌
    │       ├── logging.ts       # 運行日誌雙寫入口（DB + Pino）
    │       ├── types.ts         # 全量領域型別
    │       ├── auth/            # 簡易密碼登入 + JWT
    │       ├── db/              # SQLite 連線、遷移、seed、倉庫層
    │       │   ├── migrate.ts   # 遷移腳本（冪等）
    │       │   └── repos/       # bots / personas / models / providers / memories / system-logs ...
    │       ├── llm/             # LLM Provider 封裝
    │       │   ├── openai.ts    # OpenAI 相容（DeepSeek / 自訂）
    │       │   ├── anthropic.ts # Claude
    │       │   ├── google.ts    # Gemini
    │       │   ├── mock.ts      # 本機聯調
    │       │   ├── discover.ts  # 供應商模型自動偵測
    │       │   ├── vision*.ts   # 讀圖判定 / 掃描 / 轉述降級
    │       │   └── factory.ts   # 依角色 / Bot 設定解析 Provider
    │       ├── qq/              # QQ Bot 接入
    │       │   ├── token.ts     # access_token 取得與自動更新
    │       │   ├── client.ts    # OpenAPI 訊息發送 / 取得閘道
    │       │   ├── gateway.ts   # WebSocket 閘道（心跳 / 重連 / 事件解析）
    │       │   └── manager.ts   # 多 Bot 閘道管理
    │       ├── attachments/     # 圖片 / 檔案附件處理
    │       ├── moderation/      # 敏感詞過濾（選用）
    │       ├── context/         # 滑動視窗 / 滾動摘要 / 狀態機 / 護欄
    │       ├── persona/prompt.ts# System Prompt 組裝（穩定前綴 + 動態後綴）
    │       ├── skills/          # 技能系統 + 內建「前任」Skill + GitHub 自動更新
    │       ├── memory/          # 分層記憶：總結 / 注入 / 使用者畫像 / 即時事實 / 行程 / Markdown 落盤
    │       ├── painting/        # AI 繪畫（依角色設定生成）
    │       ├── pipeline/        # 訊息處理管線（防抖合併 / 打斷取消 / 失敗重試）
    │       ├── proactive/       # 主動訊息
    │       ├── stats/           # 統計聚合
    │       ├── cron/            # node-cron 定時任務
    │       └── routes/          # REST API
    └── admin/                   # 管理後台前端
        └── src/
            ├── App.tsx          # 路由 + 驗證
            ├── assets/providers/# 內建品牌 SVG 圖示
            ├── components/      # Layout、UI 元件、ModelIcon
            ├── lib/             # api 客戶端 / 型別 / auth
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Logs / Stats / Skills / Settings
```

## 快速開始

```bash
# 1. 安裝相依套件（需要 pnpm 9+ / Node 20+）
pnpm install

# 2. 準備環境變數
cp .env.example .env
# 修改 ADMIN_PASSWORD / JWT_SECRET / ENCRYPTION_KEY

# 3. 初始化資料庫（首次會自動遷移）
pnpm --filter @personabot/server migrate

# 4. 開發模式（後端 + 前端並行）
pnpm dev
# 後端 http://localhost:3000
# 前端 http://localhost:5173 （已設定 /api 反向代理）

# 5. 生產建置並啟動
pnpm build
pnpm start
# 管理後台與 API 同時掛載於 http://localhost:3000
```

### 前端程式碼分割

管理後台依路由延遲載入各頁面（React.lazy + Suspense），圖表等重度相依套件獨立分包，
首屏主包從約 700KB 降至約 215KB（gzip 約 69KB）。

## 模型管理與多模態

「模型管理」以**供應商卡片**為首頁，供應商級設定（名稱 / API Base / 金鑰）統一維護並級聯到其下所有模型，模型本身只儲存 `modelId`、顯示名稱、溫度、最大 token、讀圖開關與啟用狀態。

- **新增供應商**：可先建立空供應商（尚無模型），之後再補充模型；金鑰留空時沿用已儲存金鑰。
- **自動識別**：依填寫或選擇的供應商名稱比對品牌圖示與預設（含 OpenAI / Claude / Gemini / DeepSeek / 通義 / 智譜 / Moonshot / 火山 / 混元 等），圖示為內建真實品牌 SVG。
- **偵測拉取**：呼叫上游 `/models` 自動探索可用模型並批次加入；也支援手動新增或移除單一模型。
- **連通性測試**：對單一模型送出最小請求，回傳回覆內容與 token 用量。
- **讀圖能力掃描**：結合命名規則與實測（可持久化）判定模型是否支援圖片輸入。

多模態輸入流程：QQ 圖片 / 檔案先經附件處理模組正規化；主模型支援讀圖時直接隨訊息送出，不支援時自動改由視覺副模型轉述為文字後重試同一次請求。圖片大小與尺寸限制依供應商分別適配。

## 日誌體系

「日誌」頁分為兩個 Tab，資料來源彼此獨立：

| 類型 | 記錄內容 | 用途 |
| --- | --- | --- |
| 訊息日誌（`message_logs`） | 收發的對話正文、方向、角色、Bot、使用者 | 回顧「說了什麼」，也是統計與記憶總結的資料來源 |
| 運行日誌（`system_logs`） | 層級、類別、階段、耗時、結構化明細 | 排查「做了什麼、耗時多久、為何失敗」 |

運行日誌涵蓋：

- 回覆生成開始與結束（角色、供應商、模型、歷史筆數、是否含圖片、使用者輸入）；
- 每次模型請求與回應（`apiBase`、溫度、最大 token、訊息筆數、字元數、耗時、usage）；
- 上游拒絕圖片輸入後的視覺降級重試；
- 狀態護欄命中後帶強制指令重試；
- 連通性測試、模型偵測、讀圖掃描；
- 生成失敗的錯誤名稱、訊息與堆疊。

兩類日誌均支援依角色、使用者、關鍵字與時間範圍篩選，分頁瀏覽並匯出 JSON / Markdown；訊息日誌另有方向篩選，運行日誌另有層級與類別篩選。使用者篩選從既有日誌聚合為下拉選項。

## 記憶與會話

- **分層記憶**：日 / 三日 / 兩週 / 月記憶逐層濃縮，配合使用者畫像與原子事實。
- **核心記憶**：達到重要性門檻的約定 / 偏好 / 事實進入受保護區，獨立注入，不隨檔案編輯遺失。
- **相關記憶檢索**：依目前輸入與待辦話題檢索片段，避免全量注入。
- **記憶檔案增量注入**：內容與上一輪一致時只注入佔位提示，減少重複 Token。
- **即時事實**：對話中命中約定 / 偏好 / 重要資訊立即寫入長期記憶，下一輪即可生效。
- **會話治理**：滑動視窗保留最近 N 輪原文，更早對話滾動摘要；會話逾時後先把長期記憶點遷移到核心記憶再開啟新會話，避免記憶隨快取遺失。
- **狀態護欄**：作業未完成等情境下攔截並重試催睡類回覆。

## 敏感詞過濾（選用）

在「系統設定 → 敏感詞過濾」中開啟，詞表依換行 / 逗號 / 分號分隔。命中使用者訊息後：

- **攔截**：不進入模型，回覆固定提示；
- **替換為 \***：命中詞替換為等長星號後繼續對話。

預設關閉，定位為基礎營運過濾，並非內容審查。

## 記憶檔案 AI 追加（選用）

三個記憶檔案（`MEMORY.md` / `USER.md` / `persona-state.md`）在使用者手動編輯後預設不再被自動覆寫。若希望 AI 繼續累積記憶又不破壞使用者原文：

1. 在「系統設定 → 記憶檔案 AI 追加」開啟全域開關；
2. 在「記憶」頁選取檔案，對已手動編輯的檔案開啟「允許 AI 追加」。

開啟後，每日記憶生成時會把當天新內容追加到檔案末尾的 `<!-- AI:APPEND -->` 追加區：

- 使用者原文（標記之前）永不被修改；
- 追加內容依行去重，重複內容不會再次寫入；
- 關閉檔案層級開關即停止追加，原文與已追加內容仍保留。

## 品質與測試

```bash
# 型別檢查（server + admin）
pnpm -r typecheck

# 單元測試（node:test，涵蓋時鐘/文字拆分/狀態守衛/敏感詞過濾/上下文與記憶/供應商設定/運行日誌/限流）
pnpm test

# 建置
pnpm build
```

CI 流水線見 `.github/workflows/ci.yml`，在 push / PR 時執行 typecheck、test、build。

## 安全說明

- **預設金鑰保護**：`NODE_ENV=production` 時若 `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY` 仍為預設值會拒絕啟動；開發環境僅警示。
- **管理員密碼雜湊（選用）**：設定 `ADMIN_PASSWORD_HASH`（`scrypt$salt$hash`）後優先於明文密碼驗證，登入比對為常數時間。生成指令：

```bash
node packages/server/dist/scripts/hash-password.js "你的密碼"
```

- **敏感欄位加密**：QQ ClientSecret、LLM API Key、繪畫 Key、GitHub Token 均以 AES-256-GCM 加密落庫；介面只回傳是否已設定，永不回傳明文。
- **驗證**：除登入與健康檢查外所有介面都需登入狀態，同時支援 `Authorization: Bearer`（API）與 httpOnly cookie（瀏覽器重新整理），cookie 在生產環境帶 `Secure`。
- **登入限流**：同一 IP 15 分鐘內最多 10 次登入嘗試。
- **CORS 預設關閉**：同源部署無需 CORS；如需跨域，透過 `CORS_ORIGINS` 明確白名單，不允許任意來源攜帶憑證。
- **伺服器 Agent 指令攔截**：內建災難性指令黑名單（格式化、區塊裝置寫入、關機、遞迴刪根、清空防火牆等），即便開啟 Agent 也會拒絕執行。
- **網路逾時**：所有外部請求（QQ / LLM / 繪畫 / GitHub / 附件下載）均設逾時，避免連線掛起與記憶體洩漏。
- **日誌脫敏**：Pino 日誌對 `clientSecret` / `apiKey` / `password` 等欄位做 redact；運行日誌記錄請求中繼資料、耗時與錯誤原因，為便於排查可能包含對話內容片段。

## 資料備份

SQLite 使用 `VACUUM INTO` 生成一致性線上快照（無需停機），預設保留最近 10 份，存放於 `data/backups/`：

```bash
# 備份並保留最近 10 份
pnpm --filter @personabot/server backup

# 自訂保留份數
node packages/server/dist/scripts/backup.js 20
```

## 資料模型

| 表 | 說明 |
| --- | --- |
| `bots` | QQ Bot 實例，ClientSecret 加密儲存，綁定 persona |
| `personas` | 角色人格定義包（提示詞 / 性格 / 技能 / 指令池 / 繪畫 / 模型設定） |
| `models` | LLM 模型設定（Provider / API Key / Base / 溫度 / 最大 token / 讀圖 / 啟用） |
| `providers` | 供應商級設定（名稱 / Base / 加密金鑰），支援尚無模型的空供應商 |
| `memories` | 分層記憶（daily / three_day / biweekly / monthly） |
| `conversations` | 會話歷史（只追加，保證快取前綴重用） |
| `user_profiles` | 使用者習慣畫像 |
| `stats` | 每日統計（Token / 快取命中 / 圖片 / 訊息數） |
| `message_logs` | 訊息流水（統計與記憶總結的資料來源） |
| `system_logs` | 運行日誌（層級 / 類別 / 階段 / 耗時 / 結構化明細，含索引） |
| `token_usage` | 每次呼叫的 Token 用量明細 |
| `painting_logs` | 繪畫記錄與每日限額依據 |
| `skills` | 技能外掛（內建 / 自訂 / GitHub 同步） |
| `settings` | 系統鍵值設定 |

遷移腳本位於 `packages/server/src/db/migrate.ts`，依 id 順序執行並記錄於 `_migrations` 表，可重複安全執行。

## REST API 概覽

| 分組 | 端點 |
| --- | --- |
| 驗證 | `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me` |
| Bot | `GET/POST /api/bots`、`PUT/DELETE /api/bots/:id`、`POST /api/bots/:id/toggle|restart`、`GET /api/bots/status` |
| 角色 | `GET/POST /api/personas`、`PUT/DELETE /api/personas/:id`、`POST /api/personas/:id/simulate` |
| 模型 | `GET/POST /api/models`、`POST /api/models/batch`、`PUT/DELETE /api/models/:id`、`POST /api/models/:id/test|discover`、`POST /api/models/discover`、`POST /api/models/vision-scan` |
| 供應商 | `GET /api/models/providers`、`POST/PUT/DELETE /api/models/providers`、`POST /api/models/providers/discover` |
| 記憶 | `GET /api/memories`、`GET /api/memories/users`、`POST /api/memories/trigger|import`、`PUT/DELETE /api/memories/:id`、`GET/PUT /api/memories/file(s)`、`POST /api/memories/file/reset`、`PUT /api/memories/file/append` |
| 日誌 | `GET /api/logs`、`GET /api/logs/users`、`GET /api/logs/export`、`GET /api/logs/events`、`GET /api/logs/events/export` |
| 統計 | `GET /api/stats/dashboard|trends|persona/:id|messages` |
| 技能 | `GET/POST /api/skills`、`PUT/DELETE /api/skills/:id`、`POST /api/skills/sync` |
| 設定 | `GET/PUT /api/settings`、`GET /api/system/info` |
| 維運 | `POST /api/system/proactive/run|daily/run|tokens/refresh|bots/reload` |

除 `login` 與 `health` 外，所有介面都需要登入狀態（`Authorization: Bearer <token>` 或 cookie）。

## 定時任務

| 任務 | 時間 | 說明 |
| --- | --- | --- |
| 日記憶生成 | 每天 00:00 | 整理前一天的聊天記錄，生成清晰的日記憶 |
| 統計重置 | 每天 00:05 | 新一天統計從零開始 |
| 三日記憶 | 每 3 天 01:00 | 彙整過去 3 天日記憶 |
| 精簡記憶 | 每 2 週 02:00 | 壓縮兩週記憶 |
| 月記憶 | 每月 1 日 03:00 | 彙整兩週精簡記憶 |
| Token 更新 | 每天 04:00 | 更新即將過期的 access_token |
| 主動訊息 | 每 30 分鐘 | 依使用者活躍時段與角色性格發起 |
| 每日問候 | 每 15 分鐘 | 命中使用者活躍時段且當天未發時發送 |
| 記憶體清理 | 每天 04:30 | 清理主動訊息記憶體計數 |
| Bot 閘道同步 | 每 5 分鐘 | 同步資料庫中的 Bot 啟停狀態 |
| Skill 自動更新 | 可設定 | 從 GitHub 倉庫拉取最新 Skill |

## 快取命中率最佳化

1. System Prompt 前綴穩定：角色人格定義放最前，位元組級不變；時間/記憶等動態內容放在末尾。
2. 同會話重用上下文前綴：同一使用者與角色始終使用同一會話。
3. 最小工具集 + 只追加會話：會話歷史只追加，不重寫、不重新總結更早輪次。
4. 自動壓縮重用前綴：摘要追加到訊息末尾。
5. 快取指標追蹤：統計頁展示 `cacheRead / (input + cacheRead + cacheWrite)` 命中率。

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

資料庫檔案位於 `data/`，日誌位於 `logs/`，敏感資訊統一由 `.env` 管理。

## 本機聯調（無需真實憑證）

1. 在「模型管理」新增一個供應商卡片（`provider = mock`，或留空直接不設定模型，系統會自動回退到 Mock），再依需求新增模型。
2. 在「角色管理」新增角色，編輯人格提示詞，點擊「模擬」即可在本機與角色對話。
3. 在「記憶管理」手動觸發生成日/三日/月記憶，驗證分層記憶注入。
