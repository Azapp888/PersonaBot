# PersonaBot

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

A lightweight role-play QQ bot management system. Each QQ bot is bound to a persona and always speaks in that persona's voice. Prompts, skill plugins, command pools and painting settings are all configurable from the admin console. The memory system uses layered summarization with time awareness, and multiple bots can run independently.

The current version also provides:

- **Provider-level model management**: configure name / Base URL / key per provider card, discover available models in one click, scan multimodal capabilities and use real brand icons;
- **Image and file understanding**: accepts QQ images and attachments; when the primary model cannot read images, a vision side model transcribes them and the request is retried;
- **Complete logging**: message logs record "what was said", run logs record "what happened, how long it took, why it failed", with filtering, paging and JSON / Markdown export;
- **Layered memory and conversation governance**: rolling summaries + sliding window + core memory + incremental injection, together with session-timeout migration and a state guardrail.

## Tech stack

| Layer | Choice |
| --- | --- |
| Admin console | React + TypeScript + Vite + Tailwind CSS (shadcn-style components) |
| Backend | Node.js + Fastify |
| Database | SQLite (better-sqlite3) with built-in migrations |
| Cache | In-memory cache + file cache (no Redis) |
| Scheduling | node-cron |
| QQ integration | QQ official bot API v2 (HTTPS OpenAPI + WebSocket gateway) |
| AI models | Unified LLM Provider interface (OpenAI-compatible / Anthropic / Google / custom / Mock), built-in provider presets and automatic model discovery |
| Multimodal | Direct image input with vision side-model fallback (retry after transcription when the primary model rejects images) |
| Deployment | Admin console and API served by the same process on one port; Docker / pm2 / systemd supported |

## Project layout

```
PersonaBot/
├── package.json                 # pnpm workspace root
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── packages/
    ├── server/                  # Backend service
    │   └── src/
    │       ├── index.ts         # Process entry (DB → routes → bot gateway → cron)
    │       ├── app.ts           # Fastify application assembly
    │       ├── config.ts        # Environment variables and defaults
    │       ├── logger.ts        # Pino logger
    │       ├── logging.ts       # Run-log dual write (DB + Pino)
    │       ├── types.ts         # Domain types
    │       ├── auth/            # Password login + JWT
    │       ├── db/              # SQLite connection, migrations, seed, repositories
    │       │   ├── migrate.ts   # Idempotent migrations
    │       │   └── repos/       # bots / personas / models / providers / memories / system-logs ...
    │       ├── llm/             # LLM Provider wrappers
    │       │   ├── openai.ts    # OpenAI-compatible (DeepSeek / custom)
    │       │   ├── anthropic.ts # Claude
    │       │   ├── google.ts    # Gemini
    │       │   ├── mock.ts      # Local development
    │       │   ├── discover.ts  # Provider model discovery
    │       │   ├── vision*.ts   # Vision detection / scan / transcription fallback
    │       │   └── factory.ts   # Resolve Provider from persona / bot config
    │       ├── qq/              # QQ bot integration
    │       │   ├── token.ts     # access_token retrieval and refresh
    │       │   ├── client.ts    # OpenAPI message sending / gateway URL
    │       │   ├── gateway.ts   # WebSocket gateway (heartbeat / reconnect / events)
    │       │   └── manager.ts   # Multi-bot gateway management
    │       ├── attachments/     # Image / file attachment handling
    │       ├── moderation/      # Keyword filtering (optional)
    │       ├── context/         # Sliding window / rolling summary / state machine / guardrail
    │       ├── persona/prompt.ts# System prompt assembly (stable prefix + dynamic suffix)
    │       ├── skills/          # Skill system + built-in "ex" skill + GitHub auto-update
    │       ├── memory/          # Layered memory: summary / injection / profiles / realtime facts / schedule / Markdown files
    │       ├── painting/        # AI painting configured per persona
    │       ├── pipeline/        # Message pipeline (debounce merge / interruption / retry)
    │       ├── proactive/       # Proactive messages
    │       ├── stats/           # Statistics aggregation
    │       ├── cron/            # node-cron jobs
    │       └── routes/          # REST API
    └── admin/                   # Admin frontend
        └── src/
            ├── App.tsx          # Routing + auth
            ├── assets/providers/# Built-in brand SVG icons
            ├── components/      # Layout, UI components, ModelIcon
            ├── lib/             # API client / types / auth
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Logs / Stats / Skills / Settings
```

## Quick start

```bash
# 1. Install dependencies (pnpm 9+ / Node 20+)
pnpm install

# 2. Prepare environment variables
cp .env.example .env
# Change ADMIN_PASSWORD / JWT_SECRET / ENCRYPTION_KEY

# 3. Initialize the database (migrations run automatically on first start)
pnpm --filter @personabot/server migrate

# 4. Development mode (backend + frontend in parallel)
pnpm dev
# Backend http://localhost:3000
# Frontend http://localhost:5173 (/api reverse proxy already configured)

# 5. Production build and start
pnpm build
pnpm start
# Admin console and API are both served at http://localhost:3000
```

### Frontend code splitting

Admin pages are lazily loaded per route (React.lazy + Suspense), and heavy dependencies such as charts are split into separate chunks. The initial bundle drops from about 700KB to about 215KB (about 69KB gzipped).

## Model management and multimodal input

The Models page is a **provider card** list. Provider-level settings (name / API Base / key) are maintained once and cascade to every model underneath. Each model only stores `modelId`, display name, temperature, max tokens, the vision flag and enabled state.

- **Add a provider**: create an empty provider first (no models), then add models later; leaving the key blank reuses the saved key.
- **Automatic recognition**: the provider name you enter or select is matched against brand icons and presets (OpenAI / Claude / Gemini / DeepSeek / Qwen / Zhipu / Moonshot / Volcano / Hunyuan and others). Icons are built-in official brand SVGs.
- **Discovery**: calls the upstream `/models` endpoint to discover available models and add them in bulk; models can also be added or removed individually.
- **Connectivity test**: sends a minimal request to a single model and returns the reply and token usage.
- **Vision capability scan**: combines naming rules with optional live probes (persistable) to decide whether a model accepts image input.

Multimodal flow: QQ images and files are normalized by the attachment module; if the primary model supports vision they are sent with the message, otherwise a vision side model transcribes them to text and the same request is retried. Size and dimension limits are adapted per provider.

## Logging

The Logs page has two tabs backed by independent data sources:

| Type | Records | Purpose |
| --- | --- | --- |
| Message log (`message_logs`) | Conversation text, direction, persona, bot, user | Review "what was said"; also the source for stats and memory summaries |
| Run log (`system_logs`) | Level, category, stage, duration, structured detail | Investigate "what happened, how long it took, why it failed" |

Run logs cover:

- Start and end of reply generation (persona, provider, model, history length, whether images are present, user input);
- Every model request and response (`apiBase`, temperature, max tokens, message count, character count, duration, usage);
- Vision fallback retry after the upstream rejects image input;
- Retry with a forced instruction after the state guardrail triggers;
- Connectivity tests, model discovery, vision scans;
- Error name, message and stack for failed generations.

Both logs support filtering by persona, user, keyword and time range, with paging and JSON / Markdown export. Message logs additionally filter by direction, run logs by level and category. The user filter is a dropdown aggregated from existing logs.

## Memory and conversations

- **Layered memory**: daily / three-day / biweekly / monthly memories are condensed layer by layer, together with user profiles and atomic facts.
- **Core memory**: agreements, preferences and facts above an importance threshold enter a protected area and are injected independently, so editing files never loses them.
- **Relevant memory retrieval**: snippets are retrieved from the current input and pending topics to avoid injecting everything.
- **Incremental memory files**: when content is unchanged from the previous turn, only a placeholder is injected, saving tokens.
- **Realtime facts**: agreements, preferences and important details detected during a conversation are written to long-term memory immediately and take effect on the next turn.
- **Conversation governance**: a sliding window keeps the most recent N rounds verbatim while older turns are rolled into a summary; when a session times out, long-term points are migrated into core memory before a new session starts, so memory is not lost with the cache.
- **State guardrail**: intercepts and retries "go to sleep" style replies when, for example, homework is still unfinished.

## Keyword filtering (optional)

Enable it under "Settings → Keyword filtering". The word list is separated by newlines, commas or semicolons. When a user message matches:

- **Block**: the message never reaches the model and a fixed notice is returned;
- **Replace with \***: matched words are replaced with an equal number of asterisks and the conversation continues.

Disabled by default. This is basic operational filtering, not content moderation.

## AI append to memory files (optional)

The three memory files (`MEMORY.md` / `USER.md` / `persona-state.md`) are no longer overwritten automatically once you edit them by hand. If you want the AI to keep accumulating memory without destroying your text:

1. Enable the global switch under "Settings → AI append to memory files";
2. On the Memories page, select a file and enable "Allow AI append" for files you have edited manually.

Once enabled, the daily memory job appends the day's new content to the `<!-- AI:APPEND -->` section at the end of the file:

- Your original text (before the marker) is never modified;
- Appended content is deduplicated line by line;
- Turning the file-level switch off stops appends while keeping both the original and previously appended content.

## Quality and testing

```bash
# Type checking (server + admin)
pnpm -r typecheck

# Unit tests (node:test; covers clock, text splitting, state guardrail, keyword filtering, context and memory, provider config, run logs, rate limiting)
pnpm test

# Build
pnpm build
```

CI is defined in `.github/workflows/ci.yml` and runs typecheck, test and build on every push and pull request.

## Security

- **Default secret protection**: with `NODE_ENV=production`, the server refuses to start if `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY` still hold their default values; the development environment only warns.
- **Admin password hash (optional)**: setting `ADMIN_PASSWORD_HASH` (`scrypt$salt$hash`) takes precedence over the plaintext password and compares in constant time. Generate it with:

```bash
node packages/server/dist/scripts/hash-password.js "your-password"
```

- **Sensitive field encryption**: QQ ClientSecret, LLM API keys, painting keys and GitHub tokens are stored with AES-256-GCM; APIs only report whether a value is configured and never return plaintext.
- **Authentication**: every endpoint except login and health check requires a session, via either `Authorization: Bearer` (API) or an httpOnly cookie (browser refresh); cookies use `Secure` in production.
- **Login rate limiting**: at most 10 login attempts per IP within 15 minutes.
- **CORS disabled by default**: same-origin deployment needs no CORS; for cross-origin access, list allowed origins explicitly in `CORS_ORIGINS` so credentials are never reflected to arbitrary origins.
- **Server agent command blocking**: a built-in blacklist of catastrophic commands (formatting, raw block-device writes, shutdown, recursive root deletion, firewall flushing and similar) is rejected even when the agent is enabled.
- **Network timeouts**: all external requests (QQ / LLM / painting / GitHub / attachment download) have timeouts to prevent hanging connections and memory leaks.
- **Log redaction**: the Pino logger redacts `clientSecret` / `apiKey` / `password` and similar fields; run logs record request metadata, durations and error causes, and may include conversation snippets to aid troubleshooting.

## Backups

SQLite uses `VACUUM INTO` to produce consistent online snapshots without downtime. The 10 most recent snapshots are kept in `data/backups/`:

```bash
# Back up and keep the 10 most recent snapshots
pnpm --filter @personabot/server backup

# Custom retention count
node packages/server/dist/scripts/backup.js 20
```

## Data model

| Table | Description |
| --- | --- |
| `bots` | QQ bot instances; ClientSecret is encrypted and a persona is bound |
| `personas` | Persona definition bundles (prompt / traits / skills / commands / painting / model config) |
| `models` | LLM model config (provider / API key / base / temperature / max tokens / vision / enabled) |
| `providers` | Provider-level config (name / base / encrypted key); empty providers are allowed |
| `memories` | Layered memories (daily / three_day / biweekly / monthly) |
| `conversations` | Conversation history (append-only to keep the cached prefix reusable) |
| `user_profiles` | User habit profiles |
| `stats` | Daily stats (tokens / cache hits / images / message count) |
| `message_logs` | Message stream (source for stats and memory summaries) |
| `system_logs` | Run logs (level / category / stage / duration / structured detail, indexed) |
| `token_usage` | Token usage detail per call |
| `painting_logs` | Painting records and the basis for daily quotas |
| `skills` | Skill plugins (built-in / custom / GitHub sync) |
| `settings` | Key-value system settings |

Migrations live in `packages/server/src/db/migrate.ts`. They run in id order and are recorded in `_migrations`, so they are safe to re-run.

## REST API overview

| Group | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Bots | `GET/POST /api/bots`, `PUT/DELETE /api/bots/:id`, `POST /api/bots/:id/toggle|restart`, `GET /api/bots/status` |
| Personas | `GET/POST /api/personas`, `PUT/DELETE /api/personas/:id`, `POST /api/personas/:id/simulate` |
| Models | `GET/POST /api/models`, `POST /api/models/batch`, `PUT/DELETE /api/models/:id`, `POST /api/models/:id/test|discover`, `POST /api/models/discover`, `POST /api/models/vision-scan` |
| Providers | `GET /api/models/providers`, `POST/PUT/DELETE /api/models/providers`, `POST /api/models/providers/discover` |
| Memories | `GET /api/memories`, `GET /api/memories/users`, `POST /api/memories/trigger|import`, `PUT/DELETE /api/memories/:id`, `GET/PUT /api/memories/file(s)`, `POST /api/memories/file/reset`, `PUT /api/memories/file/append` |
| Logs | `GET /api/logs`, `GET /api/logs/users`, `GET /api/logs/export`, `GET /api/logs/events`, `GET /api/logs/events/export` |
| Stats | `GET /api/stats/dashboard|trends|persona/:id|messages` |
| Skills | `GET/POST /api/skills`, `PUT/DELETE /api/skills/:id`, `POST /api/skills/sync` |
| Settings | `GET/PUT /api/settings`, `GET /api/system/info` |
| Operations | `POST /api/system/proactive/run|daily/run|tokens/refresh|bots/reload` |

Every endpoint except `login` and `health` requires a session (`Authorization: Bearer <token>` or a cookie).

## Scheduled jobs

| Job | Schedule | Description |
| --- | --- | --- |
| Daily memory | Every day at 00:00 | Organize the previous day's chats into a clear daily memory |
| Stats reset | Every day at 00:05 | Start the new day's stats from zero |
| Three-day memory | Every 3 days at 01:00 | Summarize the past 3 daily memories |
| Condensed memory | Every 2 weeks at 02:00 | Compress two weeks of memory |
| Monthly memory | 1st of each month at 03:00 | Summarize the two-week condensed memories |
| Token refresh | Every day at 04:00 | Refresh access tokens nearing expiry |
| Proactive messages | Every 30 minutes | Initiated according to user active hours and persona traits |
| Daily greeting | Every 15 minutes | Sent when a user's active window is hit and nothing was sent that day |
| Memory cleanup | Every day at 04:30 | Clear proactive in-memory counters |
| Bot gateway sync | Every 5 minutes | Sync bot start/stop state from the database |
| Skill auto-update | Configurable | Pull the latest skills from the GitHub repository |

## Cache hit optimization

1. Stable system prompt prefix: the persona definition comes first and stays byte-identical; dynamic content such as time and memory goes last.
2. Reuse the context prefix per conversation: the same user and persona always share one conversation.
3. Minimal tool set and append-only history: conversation history is only appended, never rewritten or re-summarized for earlier turns.
4. Automatic compression reuses the prefix: summaries are appended to the end of the message list.
5. Cache metrics: the Stats page shows `cacheRead / (input + cacheRead + cacheWrite)`.

## Deployment

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

The database lives in `data/`, logs in `logs/`, and secrets are managed through `.env`.

## Local testing without real credentials

1. Create a provider card under "Models" (`provider = mock`, or leave it empty and skip model setup entirely to fall back to Mock), then add models as needed.
2. Create a persona under "Personas", edit the prompt and click "Simulate" to chat with the persona locally.
3. Trigger daily / three-day / monthly memory generation under "Memories" to verify layered memory injection.
