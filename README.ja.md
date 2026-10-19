# PersonaBot

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

軽量なロールプレイ型 QQ Bot 管理システムです。各 QQ Bot は 1 つのペルソナに紐づき、すべての会話をそのペルソナとして行います。プロンプト、スキルプラグイン、コマンドプール、お絵かき設定はすべて管理画面から設定できます。記憶システムは階層要約と時間認識のアーキテクチャを採用し、複数の Bot を独立して運用できます。

現在のバージョンには次の機能もあります。

- **プロバイダー単位のモデル管理**：プロバイダーカードごとに名前 / Base URL / キーを一元設定し、利用可能なモデルをワンクリックで検出、マルチモーダル能力のスキャンと実際のブランドアイコンに対応。
- **画像・ファイル理解**：QQ の画像や添付ファイルを受け付け、メインモデルが画像を読めない場合は視覚用サブモデルが文章化して同じリクエストを再試行。
- **完全なログ体系**：メッセージログは「何を話したか」、実行ログは「何をしたか、所要時間、失敗理由」を記録し、絞り込み・ページ送り・JSON / Markdown エクスポートに対応。
- **階層記憶と会話管理**：ローリング要約 + スライディングウィンドウ + コア記憶 + 差分注入に、セッションタイムアウト時の移行と状態ガードレールを組み合わせ。

## 技術スタック

| レイヤー | 採用技術 |
| --- | --- |
| 管理画面 | React + TypeScript + Vite + Tailwind CSS（shadcn 風コンポーネント） |
| バックエンド | Node.js + Fastify |
| データベース | SQLite（better-sqlite3）、マイグレーション内蔵 |
| キャッシュ | メモリキャッシュ + ファイルキャッシュ（Redis 不使用） |
| スケジューラ | node-cron |
| QQ 連携 | QQ 公式ボット API v2（HTTPS OpenAPI + WebSocket ゲートウェイ） |
| AI モデル | 統一 LLM Provider インターフェース（OpenAI 互換 / Anthropic / Google / カスタム / Mock）、プロバイダープリセットとモデル自動検出を内蔵 |
| マルチモーダル | 画像の直接送信と視覚サブモデルへのフォールバック（メインモデルが画像を拒否した場合に文章化して再試行） |
| デプロイ | 管理画面と API を同一プロセス・同一ポートで提供。Docker / pm2 / systemd に対応 |

## ディレクトリ構成

```
PersonaBot/
├── package.json                 # pnpm workspace ルート
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── packages/
    ├── server/                  # バックエンド
    │   └── src/
    │       ├── index.ts         # プロセス入口（DB → ルート → Bot ゲートウェイ → cron）
    │       ├── app.ts           # Fastify アプリケーションの組み立て
    │       ├── config.ts        # 環境変数と既定設定
    │       ├── logger.ts        # Pino ログ
    │       ├── logging.ts       # 実行ログの二重書き込み（DB + Pino）
    │       ├── types.ts         # ドメイン型
    │       ├── auth/            # パスワードログイン + JWT
    │       ├── db/              # SQLite 接続、マイグレーション、seed、リポジトリ
    │       │   ├── migrate.ts   # 冪等なマイグレーション
    │       │   └── repos/       # bots / personas / models / providers / memories / system-logs ...
    │       ├── llm/             # LLM Provider ラッパー
    │       │   ├── openai.ts    # OpenAI 互換（DeepSeek / カスタム）
    │       │   ├── anthropic.ts # Claude
    │       │   ├── google.ts    # Gemini
    │       │   ├── mock.ts      # ローカル開発
    │       │   ├── discover.ts  # プロバイダーモデルの自動検出
    │       │   ├── vision*.ts   # 画像判定 / スキャン / 文章化フォールバック
    │       │   └── factory.ts   # ペルソナ / Bot 設定から Provider を解決
    │       ├── qq/              # QQ Bot 連携
    │       │   ├── token.ts     # access_token の取得と自動更新
    │       │   ├── client.ts    # OpenAPI メッセージ送信 / ゲートウェイ取得
    │       │   ├── gateway.ts   # WebSocket ゲートウェイ（ハートビート / 再接続 / イベント解析）
    │       │   └── manager.ts   # 複数 Bot のゲートウェイ管理
    │       ├── attachments/     # 画像 / ファイル添付の処理
    │       ├── moderation/      # キーワードフィルタ（任意）
    │       ├── context/         # スライディングウィンドウ / ローリング要約 / 状態機械 / ガードレール
    │       ├── persona/prompt.ts# System Prompt の組み立て（安定プレフィックス + 動的サフィックス）
    │       ├── skills/          # スキルシステム + 内蔵「元恋人」スキル + GitHub 自動更新
    │       ├── memory/          # 階層記憶：要約 / 注入 / ユーザープロファイル / リアルタイム事実 / スケジュール / Markdown 保存
    │       ├── painting/        # AI お絵かき（ペルソナ設定に基づく生成）
    │       ├── pipeline/        # メッセージパイプライン（デバウンス統合 / 中断 / 再試行）
    │       ├── proactive/       # 自発メッセージ
    │       ├── stats/           # 統計集計
    │       ├── cron/            # node-cron ジョブ
    │       └── routes/          # REST API
    └── admin/                   # 管理画面フロントエンド
        └── src/
            ├── App.tsx          # ルーティング + 認証
            ├── assets/providers/# 内蔵ブランド SVG アイコン
            ├── components/      # Layout、UI コンポーネント、ModelIcon
            ├── lib/             # API クライアント / 型 / 認証
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Logs / Stats / Skills / Settings
```

## クイックスタート

```bash
# 1. 依存関係をインストール（pnpm 9+ / Node 20+）
pnpm install

# 2. 環境変数を用意
cp .env.example .env
# ADMIN_PASSWORD / JWT_SECRET / ENCRYPTION_KEY を変更

# 3. データベースを初期化（初回は自動マイグレーション）
pnpm --filter @personabot/server migrate

# 4. 開発モード（バックエンド + フロントエンドを並行起動）
pnpm dev
# バックエンド http://localhost:3000
# フロントエンド http://localhost:5173 （/api リバースプロキシ設定済み）

# 5. 本番ビルドと起動
pnpm build
pnpm start
# 管理画面と API は http://localhost:3000 で同時に提供
```

### フロントエンドのコード分割

管理画面はルートごとに遅延読み込み（React.lazy + Suspense）し、チャートなどの重い依存は別チャンクに分割しています。初期バンドルは約 700KB から約 215KB（gzip 約 69KB）に削減されました。

## モデル管理とマルチモーダル入力

「モデル管理」は**プロバイダーカード**の一覧をトップに表示します。プロバイダー単位の設定（名前 / API Base / キー）を一元管理し、配下のすべてのモデルに反映します。モデル側には `modelId`、表示名、temperature、最大トークン数、画像対応フラグ、有効状態のみを保存します。

- **プロバイダー追加**：モデルを持たない空のプロバイダーを先に作成し、後からモデルを追加できます。キーを空欄にすると保存済みのキーを再利用します。
- **自動認識**：入力・選択したプロバイダー名からブランドアイコンとプリセットを照合します（OpenAI / Claude / Gemini / DeepSeek / Qwen / Zhipu / Moonshot / Volcano / Hunyuan など）。アイコンは内蔵の公式ブランド SVG です。
- **検出**：上流の `/models` を呼び出して利用可能なモデルを検出し、一括追加します。個別の追加・削除も可能です。
- **接続テスト**：単一モデルに最小リクエストを送り、応答内容とトークン使用量を返します。
- **画像対応スキャン**：命名規則と任意の実測（永続化可能）を組み合わせて、画像入力に対応しているか判定します。

マルチモーダルの流れ：QQ の画像・ファイルは添付処理モジュールで正規化されます。メインモデルが画像に対応していればそのまま送信し、対応していなければ視覚サブモデルが文章化して同じリクエストを再試行します。サイズや寸法の上限はプロバイダーごとに調整します。

## ログ体系

「ログ」ページは 2 つのタブに分かれ、データソースは互いに独立しています。

| 種類 | 記録内容 | 用途 |
| --- | --- | --- |
| メッセージログ（`message_logs`） | 会話本文、方向、ペルソナ、Bot、ユーザー | 「何を話したか」の確認。統計と記憶要約のデータ源でもある |
| 実行ログ（`system_logs`） | レベル、カテゴリ、ステージ、所要時間、構造化された詳細 | 「何をしたか、どれだけかかったか、なぜ失敗したか」の調査 |

実行ログの対象：

- 応答生成の開始と終了（ペルソナ、プロバイダー、モデル、履歴件数、画像の有無、ユーザー入力）
- すべてのモデルリクエストとレスポンス（`apiBase`、temperature、最大トークン数、メッセージ件数、文字数、所要時間、usage）
- 上流が画像入力を拒否した後の視覚フォールバック再試行
- 状態ガードレールに引っかかった後の強制指示付き再試行
- 接続テスト、モデル検出、画像スキャン
- 生成失敗時のエラー名、メッセージ、スタックトレース

どちらのログもペルソナ、ユーザー、キーワード、期間で絞り込み、ページ送りと JSON / Markdown エクスポートに対応します。メッセージログは方向、実行ログはレベルとカテゴリでも絞り込めます。ユーザーの絞り込みは既存ログから集約したドロップダウンです。

## 記憶と会話

- **階層記憶**：日次 / 3 日 / 2 週間 / 月次の記憶を段階的に圧縮し、ユーザープロファイルと原子的事実を組み合わせます。
- **コア記憶**：重要度のしきい値を超えた約束 / 好み / 事実は保護領域に入り、独立して注入されるため、ファイル編集で失われません。
- **関連記憶の検索**：現在の入力と未完了の話題から断片を検索し、全量注入を避けます。
- **記憶ファイルの差分注入**：前ターンと内容が同じ場合はプレースホルダーのみを注入し、トークンを節約します。
- **リアルタイム事実**：会話中に検出した約束 / 好み / 重要情報を即座に長期記憶へ書き込み、次のターンから反映します。
- **会話管理**：スライディングウィンドウで直近 N ターンの原文を保持し、それ以前はローリング要約にまとめます。セッションがタイムアウトした場合は長期記憶ポイントをコア記憶へ移行してから新しいセッションを開始するため、キャッシュとともに記憶が失われることはありません。
- **状態ガードレール**：宿題が未完了などの状況で「早く寝てね」系の応答を遮断して再試行します。

## キーワードフィルタ（任意）

「システム設定 → キーワードフィルタ」で有効にします。語句リストは改行・カンマ・セミコロンで区切ります。ユーザーのメッセージが一致した場合：

- **遮断**：モデルに送らず、固定の案内を返します。
- **\* に置換**：一致した語句を同じ長さのアスタリスクに置き換えて会話を続けます。

既定では無効です。基本的な運用フィルタであり、コンテンツ審査ではありません。

## 記憶ファイルへの AI 追記（任意）

3 つの記憶ファイル（`MEMORY.md` / `USER.md` / `persona-state.md`）は、手動編集後は既定で自動上書きされません。AI に記憶を蓄積させつつ原文を壊したくない場合：

1. 「システム設定 → 記憶ファイルへの AI 追記」でグローバルスイッチを有効にします。
2. 「記憶」ページでファイルを選び、手動編集したファイルに対して「AI 追記を許可」を有効にします。

有効にすると、日次記憶の生成時にその日の新規内容がファイル末尾の `<!-- AI:APPEND -->` 追記領域へ追加されます。

- ユーザーの原文（マーカーより前）は決して変更されません。
- 追記内容は行単位で重複排除され、同じ内容は再度書き込まれません。
- ファイル単位のスイッチを切ると追記は停止し、原文と既存の追記内容は保持されます。

## 品質とテスト

```bash
# 型チェック（server + admin）
pnpm -r typecheck

# ユニットテスト（node:test。時計 / テキスト分割 / 状態ガード / キーワードフィルタ / コンテキストと記憶 / プロバイダー設定 / 実行ログ / レート制限を網羅）
pnpm test

# ビルド
pnpm build
```

CI は `.github/workflows/ci.yml` に定義され、push / PR 時に typecheck、test、build を実行します。

## セキュリティ

- **既定シークレットの保護**：`NODE_ENV=production` で `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY` が既定値のままだと起動を拒否します。開発環境では警告のみです。
- **管理者パスワードハッシュ（任意）**：`ADMIN_PASSWORD_HASH`（`scrypt$salt$hash`）を設定すると平文パスワードより優先され、定数時間で比較します。生成コマンド：

```bash
node packages/server/dist/scripts/hash-password.js "your-password"
```

- **機密フィールドの暗号化**：QQ ClientSecret、LLM API キー、お絵かきキー、GitHub トークンは AES-256-GCM で保存されます。API は設定済みかどうかだけを返し、平文を返すことはありません。
- **認証**：ログインとヘルスチェックを除くすべてのエンドポイントにセッションが必要です。`Authorization: Bearer`（API）と httpOnly cookie（ブラウザの再読み込み）の両方に対応し、cookie は本番環境で `Secure` を付けます。
- **ログイン試行制限**：同一 IP で 15 分間に最大 10 回までです。
- **CORS は既定で無効**：同一オリジン配置なら CORS は不要です。クロスオリジンが必要な場合は `CORS_ORIGINS` に許可元を明示し、任意のオリジンへ資格情報を反射させません。
- **サーバー Agent コマンドの遮断**：破壊的なコマンド（フォーマット、ブロックデバイスへの直接書き込み、シャットダウン、ルートの再帰削除、ファイアウォールの全消去など）は内蔵ブラックリストで、Agent 有効時でも拒否します。
- **ネットワークタイムアウト**：外部リクエスト（QQ / LLM / お絵かき / GitHub / 添付ダウンロード）はすべてタイムアウトを設定し、接続のハングとメモリリークを防ぎます。
- **ログのマスキング**：Pino ロガーは `clientSecret` / `apiKey` / `password` などを redact します。実行ログはリクエストのメタ情報、所要時間、エラー原因を記録し、調査のため会話内容の断片を含む場合があります。

## バックアップ

SQLite は `VACUUM INTO` で一貫性のあるオンラインスナップショットを無停止で作成します。直近 10 件を `data/backups/` に保持します。

```bash
# バックアップして直近 10 件を保持
pnpm --filter @personabot/server backup

# 保持件数を指定
node packages/server/dist/scripts/backup.js 20
```

## データモデル

| テーブル | 説明 |
| --- | --- |
| `bots` | QQ Bot インスタンス。ClientSecret は暗号化して保存し、ペルソナを紐づける |
| `personas` | ペルソナ定義バンドル（プロンプト / 性格 / スキル / コマンド / お絵かき / モデル設定） |
| `models` | LLM モデル設定（Provider / API キー / Base / temperature / 最大トークン数 / 画像対応 / 有効） |
| `providers` | プロバイダー単位の設定（名前 / Base / 暗号化キー）。モデルを持たない空のプロバイダーも可 |
| `memories` | 階層記憶（daily / three_day / biweekly / monthly） |
| `conversations` | 会話履歴（キャッシュプレフィックスを再利用するため追記のみ） |
| `user_profiles` | ユーザーの習慣プロファイル |
| `stats` | 日次統計（トークン / キャッシュヒット / 画像 / メッセージ数） |
| `message_logs` | メッセージストリーム（統計と記憶要約のデータ源） |
| `system_logs` | 実行ログ（レベル / カテゴリ / ステージ / 所要時間 / 構造化詳細、インデックス付き） |
| `token_usage` | 呼び出しごとのトークン使用量 |
| `painting_logs` | お絵かき記録と日次上限の根拠 |
| `skills` | スキルプラグイン（内蔵 / カスタム / GitHub 同期） |
| `settings` | キー・バリュー形式のシステム設定 |

マイグレーションは `packages/server/src/db/migrate.ts` にあり、id 順に実行されて `_migrations` に記録されるため、何度実行しても安全です。

## REST API 概要

| グループ | エンドポイント |
| --- | --- |
| 認証 | `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me` |
| Bot | `GET/POST /api/bots`、`PUT/DELETE /api/bots/:id`、`POST /api/bots/:id/toggle|restart`、`GET /api/bots/status` |
| ペルソナ | `GET/POST /api/personas`、`PUT/DELETE /api/personas/:id`、`POST /api/personas/:id/simulate` |
| モデル | `GET/POST /api/models`、`POST /api/models/batch`、`PUT/DELETE /api/models/:id`、`POST /api/models/:id/test|discover`、`POST /api/models/discover`、`POST /api/models/vision-scan` |
| プロバイダー | `GET /api/models/providers`、`POST/PUT/DELETE /api/models/providers`、`POST /api/models/providers/discover` |
| 記憶 | `GET /api/memories`、`GET /api/memories/users`、`POST /api/memories/trigger|import`、`PUT/DELETE /api/memories/:id`、`GET/PUT /api/memories/file(s)`、`POST /api/memories/file/reset`、`PUT /api/memories/file/append` |
| ログ | `GET /api/logs`、`GET /api/logs/users`、`GET /api/logs/export`、`GET /api/logs/events`、`GET /api/logs/events/export` |
| 統計 | `GET /api/stats/dashboard|trends|persona/:id|messages` |
| スキル | `GET/POST /api/skills`、`PUT/DELETE /api/skills/:id`、`POST /api/skills/sync` |
| 設定 | `GET/PUT /api/settings`、`GET /api/system/info` |
| 運用 | `POST /api/system/proactive/run|daily/run|tokens/refresh|bots/reload` |

`login` と `health` を除くすべてのエンドポイントにセッション（`Authorization: Bearer <token>` または cookie）が必要です。

## 定期ジョブ

| ジョブ | 実行時刻 | 説明 |
| --- | --- | --- |
| 日次記憶 | 毎日 00:00 | 前日の会話を整理して明確な日次記憶を生成 |
| 統計リセット | 毎日 00:05 | 新しい一日の統計をゼロから開始 |
| 3 日記憶 | 3 日ごと 01:00 | 過去 3 日分の日次記憶を集約 |
| 圧縮記憶 | 2 週間ごと 02:00 | 2 週間分の記憶を圧縮 |
| 月次記憶 | 毎月 1 日 03:00 | 2 週間分の圧縮記憶を集約 |
| トークン更新 | 毎日 04:00 | 期限切れが近い access_token を更新 |
| 自発メッセージ | 30 分ごと | ユーザーのアクティブ時間帯とペルソナの性格に応じて送信 |
| 日次挨拶 | 15 分ごと | ユーザーのアクティブ時間帯に該当し、当日未送信の場合に送信 |
| メモリクリーンアップ | 毎日 04:30 | 自発メッセージのメモリカウンタをクリア |
| Bot ゲートウェイ同期 | 5 分ごと | DB 上の Bot 起動状態を同期 |
| スキル自動更新 | 設定可能 | GitHub リポジトリから最新のスキルを取得 |

## キャッシュヒット率の最適化

1. System Prompt のプレフィックスを固定：ペルソナ定義を先頭に置きバイト単位で不変にし、時刻や記憶などの動的コンテンツは末尾に置きます。
2. 会話ごとにコンテキストのプレフィックスを再利用：同じユーザーとペルソナは常に同じ会話を共有します。
3. 最小限のツールセットと追記のみの履歴：会話履歴は追記のみで、過去のターンを書き換えたり再要約したりしません。
4. 自動圧縮でもプレフィックスを再利用：要約はメッセージ列の末尾に追加します。
5. キャッシュ指標の追跡：統計ページに `cacheRead / (input + cacheRead + cacheWrite)` のヒット率を表示します。

## デプロイ

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

データベースは `data/`、ログは `logs/` にあり、機密情報は `.env` で一元管理します。

## 実資格情報なしのローカル確認

1. 「モデル管理」でプロバイダーカードを作成します（`provider = mock`、または空のままモデルを設定しなければ自動的に Mock にフォールバックします）。必要に応じてモデルを追加します。
2. 「ペルソナ管理」でペルソナを作成し、プロンプトを編集して「シミュレート」を押すとローカルで会話できます。
3. 「記憶管理」で日次 / 3 日 / 月次の記憶生成を手動で実行し、階層記憶の注入を確認します。
