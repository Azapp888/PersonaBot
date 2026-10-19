# PersonaBot

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

가벼운 롤플레이 QQ 봇 관리 시스템입니다. 각 QQ 봇은 하나의 페르소나에 연결되어 모든 대화를 해당 페르소나로 진행합니다. 프롬프트, 스킬 플러그인, 명령 풀, 그림 설정은 모두 관리 콘솔에서 구성할 수 있습니다. 기억 시스템은 계층 요약과 시간 인지 아키텍처를 사용하며, 여러 봇을 독립적으로 운영할 수 있습니다.

현재 버전에는 다음 기능도 포함됩니다.

- **공급자 단위 모델 관리**: 공급자 카드별로 이름 / Base URL / 키를 통합 설정하고, 사용 가능한 모델을 한 번에 감지해 가져오며, 멀티모달 능력 스캔과 실제 브랜드 아이콘을 지원합니다.
- **이미지 및 파일 이해**: QQ 이미지와 첨부 파일을 입력받으며, 기본 모델이 이미지를 읽지 못하면 비전 보조 모델이 텍스트로 설명한 뒤 같은 요청을 재시도합니다.
- **완전한 로그 체계**: 메시지 로그는 "무엇을 말했는지", 실행 로그는 "무엇을 했는지, 얼마나 걸렸는지, 왜 실패했는지"를 기록하며 필터링, 페이지 이동, JSON / Markdown 내보내기를 지원합니다.
- **계층 기억과 대화 관리**: 롤링 요약 + 슬라이딩 윈도 + 핵심 기억 + 증분 주입에 세션 타임아웃 마이그레이션과 상태 가드레일을 결합했습니다.

## 기술 스택

| 계층 | 선택 |
| --- | --- |
| 관리 콘솔 | React + TypeScript + Vite + Tailwind CSS(shadcn 스타일 컴포넌트) |
| 백엔드 | Node.js + Fastify |
| 데이터베이스 | SQLite(better-sqlite3), 마이그레이션 내장 |
| 캐시 | 메모리 캐시 + 파일 캐시(Redis 미사용) |
| 스케줄러 | node-cron |
| QQ 연동 | QQ 공식 봇 API v2(HTTPS OpenAPI + WebSocket 게이트웨이) |
| AI 모델 | 통합 LLM Provider 인터페이스(OpenAI 호환 / Anthropic / Google / 사용자 정의 / Mock), 공급자 프리셋과 모델 자동 감지 내장 |
| 멀티모달 | 이미지 직접 전송 및 비전 보조 모델 폴백(기본 모델이 이미지를 거부하면 텍스트로 변환 후 재시도) |
| 배포 | 관리 콘솔과 API를 같은 프로세스, 같은 포트에서 제공. Docker / pm2 / systemd 지원 |

## 디렉터리 구조

```
PersonaBot/
├── package.json                 # pnpm workspace 루트
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── packages/
    ├── server/                  # 백엔드 서비스
    │   └── src/
    │       ├── index.ts         # 프로세스 진입점(DB → 라우트 → 봇 게이트웨이 → cron)
    │       ├── app.ts           # Fastify 애플리케이션 조립
    │       ├── config.ts        # 환경 변수와 기본 설정
    │       ├── logger.ts        # Pino 로거
    │       ├── logging.ts       # 실행 로그 이중 기록(DB + Pino)
    │       ├── types.ts         # 도메인 타입
    │       ├── auth/            # 비밀번호 로그인 + JWT
    │       ├── db/              # SQLite 연결, 마이그레이션, seed, 리포지토리
    │       │   ├── migrate.ts   # 멱등 마이그레이션
    │       │   └── repos/       # bots / personas / models / providers / memories / system-logs ...
    │       ├── llm/             # LLM Provider 래퍼
    │       │   ├── openai.ts    # OpenAI 호환(DeepSeek / 사용자 정의)
    │       │   ├── anthropic.ts # Claude
    │       │   ├── google.ts    # Gemini
    │       │   ├── mock.ts      # 로컬 개발
    │       │   ├── discover.ts  # 공급자 모델 자동 감지
    │       │   ├── vision*.ts   # 이미지 판별 / 스캔 / 텍스트 변환 폴백
    │       │   └── factory.ts   # 페르소나 / 봇 설정으로 Provider 해석
    │       ├── qq/              # QQ 봇 연동
    │       │   ├── token.ts     # access_token 획득과 자동 갱신
    │       │   ├── client.ts    # OpenAPI 메시지 전송 / 게이트웨이 조회
    │       │   ├── gateway.ts   # WebSocket 게이트웨이(하트비트 / 재연결 / 이벤트 파싱)
    │       │   └── manager.ts   # 다중 봇 게이트웨이 관리
    │       ├── attachments/     # 이미지 / 파일 첨부 처리
    │       ├── moderation/      # 키워드 필터(선택)
    │       ├── context/         # 슬라이딩 윈도 / 롤링 요약 / 상태 머신 / 가드레일
    │       ├── persona/prompt.ts# System Prompt 조립(안정 접두사 + 동적 접미사)
    │       ├── skills/          # 스킬 시스템 + 내장 "전 연인" 스킬 + GitHub 자동 업데이트
    │       ├── memory/          # 계층 기억: 요약 / 주입 / 사용자 프로필 / 실시간 사실 / 일정 / Markdown 저장
    │       ├── painting/        # AI 그림(페르소나 설정 기반 생성)
    │       ├── pipeline/        # 메시지 파이프라인(디바운스 병합 / 중단 / 재시도)
    │       ├── proactive/       # 선제 메시지
    │       ├── stats/           # 통계 집계
    │       ├── cron/            # node-cron 작업
    │       └── routes/          # REST API
    └── admin/                   # 관리 콘솔 프런트엔드
        └── src/
            ├── App.tsx          # 라우팅 + 인증
            ├── assets/providers/# 내장 브랜드 SVG 아이콘
            ├── components/      # Layout, UI 컴포넌트, ModelIcon
            ├── lib/             # API 클라이언트 / 타입 / 인증
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Logs / Stats / Skills / Settings
```

## 빠른 시작

```bash
# 1. 의존성 설치(pnpm 9+ / Node 20+)
pnpm install

# 2. 환경 변수 준비
cp .env.example .env
# ADMIN_PASSWORD / JWT_SECRET / ENCRYPTION_KEY 변경

# 3. 데이터베이스 초기화(첫 실행 시 자동 마이그레이션)
pnpm --filter @personabot/server migrate

# 4. 개발 모드(백엔드 + 프런트엔드 동시 실행)
pnpm dev
# 백엔드 http://localhost:3000
# 프런트엔드 http://localhost:5173 (/api 리버스 프록시 설정됨)

# 5. 프로덕션 빌드 및 시작
pnpm build
pnpm start
# 관리 콘솔과 API가 http://localhost:3000 에서 함께 제공됨
```

### 프런트엔드 코드 분할

관리 콘솔은 라우트별로 페이지를 지연 로딩(React.lazy + Suspense)하고, 차트 같은 무거운 의존성은 별도 청크로 분리합니다. 초기 번들은 약 700KB에서 약 215KB(gzip 약 69KB)로 줄었습니다.

## 모델 관리와 멀티모달 입력

"모델 관리"는 **공급자 카드** 목록을 첫 화면으로 보여줍니다. 공급자 단위 설정(이름 / API Base / 키)을 한곳에서 관리하고 하위 모든 모델에 반영합니다. 모델 자체는 `modelId`, 표시 이름, temperature, 최대 토큰, 이미지 지원 플래그, 활성 상태만 저장합니다.

- **공급자 추가**: 모델이 없는 빈 공급자를 먼저 만들고 나중에 모델을 추가할 수 있습니다. 키를 비우면 저장된 키를 재사용합니다.
- **자동 인식**: 입력하거나 선택한 공급자 이름으로 브랜드 아이콘과 프리셋을 매칭합니다(OpenAI / Claude / Gemini / DeepSeek / Qwen / Zhipu / Moonshot / Volcano / Hunyuan 등). 아이콘은 내장 공식 브랜드 SVG입니다.
- **감지 및 가져오기**: 업스트림 `/models`를 호출해 사용 가능한 모델을 찾아 일괄 추가합니다. 개별 추가 및 제거도 지원합니다.
- **연결 테스트**: 단일 모델에 최소 요청을 보내 응답 내용과 토큰 사용량을 반환합니다.
- **이미지 지원 스캔**: 명명 규칙과 선택적 실측(영속화 가능)을 결합해 이미지 입력 지원 여부를 판정합니다.

멀티모달 흐름: QQ 이미지와 파일은 첨부 처리 모듈에서 정규화됩니다. 기본 모델이 이미지를 지원하면 그대로 전송하고, 지원하지 않으면 비전 보조 모델이 텍스트로 변환한 뒤 같은 요청을 재시도합니다. 크기와 해상도 제한은 공급자별로 조정합니다.

## 로그 체계

"로그" 페이지는 두 개의 탭으로 나뉘며 데이터 소스가 서로 독립적입니다.

| 유형 | 기록 내용 | 용도 |
| --- | --- | --- |
| 메시지 로그(`message_logs`) | 대화 본문, 방향, 페르소나, 봇, 사용자 | "무엇을 말했는지" 확인. 통계와 기억 요약의 데이터 소스 |
| 실행 로그(`system_logs`) | 레벨, 카테고리, 단계, 소요 시간, 구조화된 상세 | "무엇을 했는지, 얼마나 걸렸는지, 왜 실패했는지" 조사 |

실행 로그 범위:

- 응답 생성 시작과 종료(페르소나, 공급자, 모델, 기록 수, 이미지 포함 여부, 사용자 입력)
- 모든 모델 요청과 응답(`apiBase`, temperature, 최대 토큰, 메시지 수, 문자 수, 소요 시간, usage)
- 업스트림이 이미지 입력을 거부한 뒤의 비전 폴백 재시도
- 상태 가드레일 발동 후 강제 지시와 함께 재시도
- 연결 테스트, 모델 감지, 이미지 스캔
- 생성 실패 시 오류 이름, 메시지, 스택

두 로그 모두 페르소나, 사용자, 키워드, 기간으로 필터링하고 페이지 이동과 JSON / Markdown 내보내기를 지원합니다. 메시지 로그는 방향, 실행 로그는 레벨과 카테고리로 추가 필터링합니다. 사용자 필터는 기존 로그에서 집계한 드롭다운입니다.

## 기억과 대화

- **계층 기억**: 일간 / 3일 / 2주 / 월간 기억을 단계적으로 압축하고 사용자 프로필과 원자적 사실을 결합합니다.
- **핵심 기억**: 중요도 임계값을 넘은 약속 / 선호 / 사실은 보호 영역에 들어가 독립적으로 주입되므로 파일 편집으로 사라지지 않습니다.
- **관련 기억 검색**: 현재 입력과 미완료 주제에서 조각을 검색해 전체 주입을 피합니다.
- **기억 파일 증분 주입**: 이전 턴과 내용이 같으면 자리 표시자만 주입해 토큰을 절약합니다.
- **실시간 사실**: 대화 중 감지한 약속 / 선호 / 중요한 정보를 즉시 장기 기억에 기록해 다음 턴부터 반영합니다.
- **대화 관리**: 슬라이딩 윈도로 최근 N턴의 원문을 유지하고 더 이전 대화는 롤링 요약으로 합칩니다. 세션이 타임아웃되면 장기 기억 포인트를 핵심 기억으로 옮긴 뒤 새 세션을 시작하므로 캐시와 함께 기억이 사라지지 않습니다.
- **상태 가드레일**: 숙제가 끝나지 않은 등의 상황에서 "자러 가" 류의 응답을 차단하고 재시도합니다.

## 키워드 필터(선택)

"시스템 설정 → 키워드 필터"에서 활성화합니다. 단어 목록은 줄바꿈, 쉼표, 세미콜론으로 구분합니다. 사용자 메시지가 일치하면:

- **차단**: 모델에 전달하지 않고 고정 안내를 반환합니다.
- **\*로 치환**: 일치한 단어를 같은 길이의 별표로 바꾸고 대화를 계속합니다.

기본값은 비활성입니다. 기본적인 운영 필터이며 콘텐츠 검열이 아닙니다.

## 기억 파일 AI 추가(선택)

세 개의 기억 파일(`MEMORY.md` / `USER.md` / `persona-state.md`)은 사용자가 직접 편집한 뒤에는 기본적으로 자동 덮어쓰지 않습니다. AI가 계속 기억을 쌓되 원문을 훼손하지 않게 하려면:

1. "시스템 설정 → 기억 파일 AI 추가"에서 전역 스위치를 켭니다.
2. "기억" 페이지에서 파일을 선택하고 직접 편집한 파일에 "AI 추가 허용"을 켭니다.

활성화하면 일간 기억 생성 시 그날의 새 내용이 파일 끝의 `<!-- AI:APPEND -->` 추가 영역에 덧붙습니다.

- 사용자 원문(마커 앞)은 절대 수정되지 않습니다.
- 추가 내용은 줄 단위로 중복 제거되어 같은 내용이 다시 기록되지 않습니다.
- 파일 단위 스위치를 끄면 추가가 중단되고 원문과 기존 추가 내용은 유지됩니다.

## 품질과 테스트

```bash
# 타입 검사(server + admin)
pnpm -r typecheck

# 단위 테스트(node:test. 시계 / 텍스트 분할 / 상태 가드 / 키워드 필터 / 컨텍스트와 기억 / 공급자 설정 / 실행 로그 / 속도 제한 포함)
pnpm test

# 빌드
pnpm build
```

CI는 `.github/workflows/ci.yml`에 정의되어 있으며 push / PR 시 typecheck, test, build를 실행합니다.

## 보안

- **기본 시크릿 보호**: `NODE_ENV=production`에서 `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY`가 기본값이면 시작을 거부합니다. 개발 환경에서는 경고만 합니다.
- **관리자 비밀번호 해시(선택)**: `ADMIN_PASSWORD_HASH`(`scrypt$salt$hash`)를 설정하면 평문 비밀번호보다 우선하며 상수 시간으로 비교합니다. 생성 명령:

```bash
node packages/server/dist/scripts/hash-password.js "your-password"
```

- **민감 필드 암호화**: QQ ClientSecret, LLM API 키, 그림 키, GitHub 토큰은 AES-256-GCM으로 저장합니다. API는 설정 여부만 반환하고 평문을 절대 반환하지 않습니다.
- **인증**: 로그인과 헬스 체크를 제외한 모든 엔드포인트에 세션이 필요합니다. `Authorization: Bearer`(API)와 httpOnly cookie(브라우저 새로고침)를 모두 지원하며, 쿠키는 프로덕션에서 `Secure`를 사용합니다.
- **로그인 속도 제한**: 동일 IP에서 15분 내 최대 10회 시도입니다.
- **CORS 기본 비활성**: 동일 출처 배포에는 CORS가 필요 없습니다. 교차 출처가 필요하면 `CORS_ORIGINS`에 허용 출처를 명시하며, 임의 출처에 자격 증명을 반사하지 않습니다.
- **서버 Agent 명령 차단**: 파괴적인 명령(포맷, 블록 장치 직접 쓰기, 종료, 루트 재귀 삭제, 방화벽 초기화 등)은 내장 블랙리스트로 Agent가 켜져 있어도 거부합니다.
- **네트워크 타임아웃**: 모든 외부 요청(QQ / LLM / 그림 / GitHub / 첨부 다운로드)에 타임아웃을 두어 연결 정지와 메모리 누수를 방지합니다.
- **로그 마스킹**: Pino 로거는 `clientSecret` / `apiKey` / `password` 등을 redact합니다. 실행 로그는 요청 메타데이터, 소요 시간, 오류 원인을 기록하며 문제 해결을 위해 대화 내용 일부를 포함할 수 있습니다.

## 백업

SQLite는 `VACUUM INTO`로 무중단 일관성 온라인 스냅샷을 생성합니다. 최근 10개를 `data/backups/`에 보관합니다.

```bash
# 백업하고 최근 10개 보관
pnpm --filter @personabot/server backup

# 보관 개수 지정
node packages/server/dist/scripts/backup.js 20
```

## 데이터 모델

| 테이블 | 설명 |
| --- | --- |
| `bots` | QQ 봇 인스턴스. ClientSecret은 암호화 저장되며 페르소나와 연결됨 |
| `personas` | 페르소나 정의 번들(프롬프트 / 성격 / 스킬 / 명령 / 그림 / 모델 설정) |
| `models` | LLM 모델 설정(Provider / API 키 / Base / temperature / 최대 토큰 / 이미지 / 활성) |
| `providers` | 공급자 단위 설정(이름 / Base / 암호화 키). 모델이 없는 빈 공급자 허용 |
| `memories` | 계층 기억(daily / three_day / biweekly / monthly) |
| `conversations` | 대화 기록(캐시 접두사 재사용을 위해 추가 전용) |
| `user_profiles` | 사용자 습관 프로필 |
| `stats` | 일간 통계(토큰 / 캐시 적중 / 이미지 / 메시지 수) |
| `message_logs` | 메시지 스트림(통계와 기억 요약의 데이터 소스) |
| `system_logs` | 실행 로그(레벨 / 카테고리 / 단계 / 소요 시간 / 구조화 상세, 인덱스 포함) |
| `token_usage` | 호출별 토큰 사용량 |
| `painting_logs` | 그림 기록과 일일 한도 근거 |
| `skills` | 스킬 플러그인(내장 / 사용자 정의 / GitHub 동기화) |
| `settings` | 키-값 시스템 설정 |

마이그레이션은 `packages/server/src/db/migrate.ts`에 있으며 id 순서로 실행되고 `_migrations`에 기록되므로 반복 실행해도 안전합니다.

## REST API 개요

| 그룹 | 엔드포인트 |
| --- | --- |
| 인증 | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| 봇 | `GET/POST /api/bots`, `PUT/DELETE /api/bots/:id`, `POST /api/bots/:id/toggle|restart`, `GET /api/bots/status` |
| 페르소나 | `GET/POST /api/personas`, `PUT/DELETE /api/personas/:id`, `POST /api/personas/:id/simulate` |
| 모델 | `GET/POST /api/models`, `POST /api/models/batch`, `PUT/DELETE /api/models/:id`, `POST /api/models/:id/test|discover`, `POST /api/models/discover`, `POST /api/models/vision-scan` |
| 공급자 | `GET /api/models/providers`, `POST/PUT/DELETE /api/models/providers`, `POST /api/models/providers/discover` |
| 기억 | `GET /api/memories`, `GET /api/memories/users`, `POST /api/memories/trigger|import`, `PUT/DELETE /api/memories/:id`, `GET/PUT /api/memories/file(s)`, `POST /api/memories/file/reset`, `PUT /api/memories/file/append` |
| 로그 | `GET /api/logs`, `GET /api/logs/users`, `GET /api/logs/export`, `GET /api/logs/events`, `GET /api/logs/events/export` |
| 통계 | `GET /api/stats/dashboard|trends|persona/:id|messages` |
| 스킬 | `GET/POST /api/skills`, `PUT/DELETE /api/skills/:id`, `POST /api/skills/sync` |
| 설정 | `GET/PUT /api/settings`, `GET /api/system/info` |
| 운영 | `POST /api/system/proactive/run|daily/run|tokens/refresh|bots/reload` |

`login`과 `health`를 제외한 모든 엔드포인트에 세션(`Authorization: Bearer <token>` 또는 cookie)이 필요합니다.

## 예약 작업

| 작업 | 시간 | 설명 |
| --- | --- | --- |
| 일간 기억 | 매일 00:00 | 전날 대화를 정리해 명확한 일간 기억 생성 |
| 통계 초기화 | 매일 00:05 | 새 날의 통계를 0부터 시작 |
| 3일 기억 | 3일마다 01:00 | 지난 3일의 일간 기억을 취합 |
| 압축 기억 | 2주마다 02:00 | 2주 분량의 기억을 압축 |
| 월간 기억 | 매월 1일 03:00 | 2주 압축 기억을 취합 |
| 토큰 갱신 | 매일 04:00 | 만료 예정 access_token 갱신 |
| 선제 메시지 | 30분마다 | 사용자 활동 시간대와 페르소나 성격에 따라 발송 |
| 일일 인사 | 15분마다 | 사용자 활동 시간대에 해당하고 당일 미발송 시 발송 |
| 메모리 정리 | 매일 04:30 | 선제 메시지 메모리 카운터 정리 |
| 봇 게이트웨이 동기화 | 5분마다 | DB의 봇 시작/중지 상태 동기화 |
| 스킬 자동 업데이트 | 설정 가능 | GitHub 리포지토리에서 최신 스킬 가져오기 |

## 캐시 적중률 최적화

1. System Prompt 접두사 고정: 페르소나 정의를 맨 앞에 두어 바이트 단위로 불변 유지하고, 시간/기억 같은 동적 콘텐츠는 끝에 둡니다.
2. 대화별 컨텍스트 접두사 재사용: 같은 사용자와 페르소나는 항상 같은 대화를 공유합니다.
3. 최소 도구 세트와 추가 전용 기록: 대화 기록은 추가만 하며 이전 턴을 다시 쓰거나 재요약하지 않습니다.
4. 자동 압축도 접두사 재사용: 요약은 메시지 목록 끝에 추가합니다.
5. 캐시 지표 추적: 통계 페이지에 `cacheRead / (input + cacheRead + cacheWrite)` 적중률을 표시합니다.

## 배포

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

데이터베이스는 `data/`, 로그는 `logs/`에 있으며 민감 정보는 `.env`로 관리합니다.

## 실제 자격 증명 없이 로컬 테스트

1. "모델 관리"에서 공급자 카드를 만듭니다(`provider = mock`, 또는 비워 두고 모델을 설정하지 않으면 자동으로 Mock으로 폴백). 필요에 따라 모델을 추가합니다.
2. "페르소나 관리"에서 페르소나를 만들고 프롬프트를 편집한 뒤 "시뮬레이션"을 누르면 로컬에서 대화할 수 있습니다.
3. "기억 관리"에서 일간 / 3일 / 월간 기억 생성을 수동으로 실행해 계층 기억 주입을 확인합니다.
