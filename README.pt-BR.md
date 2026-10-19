# PersonaBot

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português (Brasil)](README.pt-BR.md)

Sistema leve de gerenciamento de bots de QQ com roleplay. Cada bot de QQ é vinculado a uma persona e sempre conversa com essa identidade. Prompts, plugins de habilidades, conjunto de comandos e configurações de desenho são configurados no painel de administração. O sistema de memória usa resumo em camadas com consciência temporal, e vários bots podem rodar de forma independente.

A versão atual também oferece:

- **Gerenciamento de modelos por provedor**: configure nome / Base URL / chave em cada cartão de provedor, descubra os modelos disponíveis com um clique, analise capacidades multimodais e use ícones reais de marca;
- **Compreensão de imagens e arquivos**: aceita imagens e anexos do QQ; se o modelo principal não conseguir ler imagens, um modelo auxiliar de visão as transcreve e a requisição é repetida;
- **Registro completo**: os logs de mensagens guardam "o que foi dito" e os logs de execução guardam "o que aconteceu, quanto tempo levou e por que falhou", com filtros, paginação e exportação em JSON / Markdown;
- **Memória em camadas e governança de conversas**: resumos rolantes + janela deslizante + memória central + injeção incremental, junto com migração por expiração de sessão e uma barreira de estado.

## Stack técnico

| Camada | Escolha |
| --- | --- |
| Painel de administração | React + TypeScript + Vite + Tailwind CSS (componentes no estilo shadcn) |
| Backend | Node.js + Fastify |
| Banco de dados | SQLite (better-sqlite3) com migrações integradas |
| Cache | Cache em memória + cache em arquivo (sem Redis) |
| Agendamento | node-cron |
| Integração com QQ | API oficial de bots do QQ v2 (HTTPS OpenAPI + gateway WebSocket) |
| Modelos de IA | Interface unificada de LLM Provider (compatível com OpenAI / Anthropic / Google / personalizado / Mock), presets de provedor e descoberta automática de modelos |
| Multimodal | Envio direto de imagens com fallback para modelo auxiliar de visão (nova tentativa após transcrição quando o principal recusa imagens) |
| Implantação | Painel e API no mesmo processo e porta; Docker / pm2 / systemd |

## Estrutura do projeto

```
PersonaBot/
├── package.json                 # Raiz do workspace pnpm
├── pnpm-workspace.yaml
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── packages/
    ├── server/                  # Serviço de backend
    │   └── src/
    │       ├── index.ts         # Entrada do processo (DB → rotas → gateway dos bots → cron)
    │       ├── app.ts           # Montagem da aplicação Fastify
    │       ├── config.ts        # Variáveis de ambiente e padrões
    │       ├── logger.ts        # Logger Pino
    │       ├── logging.ts       # Escrita dupla dos logs de execução (DB + Pino)
    │       ├── types.ts         # Tipos do domínio
    │       ├── auth/            # Login por senha + JWT
    │       ├── db/              # Conexão SQLite, migrações, seed, repositórios
    │       │   ├── migrate.ts   # Migrações idempotentes
    │       │   └── repos/       # bots / personas / models / providers / memories / system-logs ...
    │       ├── llm/             # Encapsulamento dos LLM Providers
    │       │   ├── openai.ts    # Compatível com OpenAI (DeepSeek / personalizado)
    │       │   ├── anthropic.ts # Claude
    │       │   ├── google.ts    # Gemini
    │       │   ├── mock.ts      # Desenvolvimento local
    │       │   ├── discover.ts  # Descoberta de modelos do provedor
    │       │   ├── vision*.ts   # Detecção / varredura / fallback por transcrição
    │       │   └── factory.ts   # Resolve o Provider a partir da persona / do bot
    │       ├── qq/              # Integração com bots do QQ
    │       │   ├── token.ts     # Obtenção e renovação do access_token
    │       │   ├── client.ts    # Envio de mensagens OpenAPI / URL do gateway
    │       │   ├── gateway.ts   # Gateway WebSocket (heartbeat / reconexão / eventos)
    │       │   └── manager.ts   # Gerenciamento de gateways de vários bots
    │       ├── attachments/     # Tratamento de imagens e anexos
    │       ├── moderation/      # Filtro de palavras-chave (opcional)
    │       ├── context/         # Janela deslizante / resumo rolante / máquina de estados / barreira
    │       ├── persona/prompt.ts# Montagem do System Prompt (prefixo estável + sufixo dinâmico)
    │       ├── skills/          # Sistema de habilidades + habilidade integrada "ex" + atualização automática via GitHub
    │       ├── memory/          # Memória em camadas: resumo / injeção / perfis / fatos em tempo real / agenda / arquivos Markdown
    │       ├── painting/        # Desenho por IA conforme a persona
    │       ├── pipeline/        # Pipeline de mensagens (agrupamento por debounce / interrupção / nova tentativa)
    │       ├── proactive/       # Mensagens proativas
    │       ├── stats/           # Agregação de estatísticas
    │       ├── cron/            # Tarefas node-cron
    │       └── routes/          # API REST
    └── admin/                   # Frontend do painel
        └── src/
            ├── App.tsx          # Rotas + autenticação
            ├── assets/providers/# Ícones SVG de marcas integrados
            ├── components/      # Layout, componentes de UI, ModelIcon
            ├── lib/             # Cliente da API / tipos / autenticação
            └── pages/           # Dashboard / Bots / Personas / Models / Memories / Logs / Stats / Skills / Settings
```

## Início rápido

```bash
# 1. Instalar dependências (pnpm 9+ / Node 20+)
pnpm install

# 2. Preparar variáveis de ambiente
cp .env.example .env
# Alterar ADMIN_PASSWORD / JWT_SECRET / ENCRYPTION_KEY

# 3. Inicializar o banco de dados (as migrações rodam no primeiro start)
pnpm --filter @personabot/server migrate

# 4. Modo de desenvolvimento (backend e frontend em paralelo)
pnpm dev
# Backend http://localhost:3000
# Frontend http://localhost:5173 (proxy reverso de /api já configurado)

# 5. Build e start em produção
pnpm build
pnpm start
# Painel e API servidos em http://localhost:3000
```

### Divisão de código do frontend

As páginas do painel são carregadas sob demanda por rota (React.lazy + Suspense), e dependências pesadas, como gráficos, ficam em chunks separados. O bundle inicial cai de cerca de 700KB para cerca de 215KB (cerca de 69KB com gzip).

## Gerenciamento de modelos e entrada multimodal

A página de modelos mostra uma lista de **cartões de provedor**. A configuração do provedor (nome / API Base / chave) é mantida em um único lugar e aplicada a todos os modelos abaixo. Cada modelo guarda apenas `modelId`, nome de exibição, temperatura, tokens máximos, indicador de visão e estado de ativação.

- **Adicionar provedor**: é possível criar primeiro um provedor vazio (sem modelos) e adicioná-los depois; deixar a chave em branco reutiliza a chave salva.
- **Reconhecimento automático**: o nome de provedor digitado ou selecionado é comparado com ícones e presets de marca (OpenAI / Claude / Gemini / DeepSeek / Qwen / Zhipu / Moonshot / Volcano / Hunyuan e outros). Os ícones são SVGs oficiais integrados.
- **Descoberta**: chama o endpoint `/models` do provedor para descobrir modelos disponíveis e adicioná-los em lote; também permite adicionar ou remover modelos individualmente.
- **Teste de conectividade**: envia uma requisição mínima a um modelo e retorna a resposta e o uso de tokens.
- **Varredura de visão**: combina regras de nomenclatura com testes reais opcionais (persistíveis) para decidir se um modelo aceita imagens.

Fluxo multimodal: imagens e arquivos do QQ passam pelo módulo de anexos; se o modelo principal suportar visão, são enviados com a mensagem, caso contrário um modelo auxiliar de visão os transcreve em texto e a mesma requisição é repetida. Os limites de tamanho e dimensões são ajustados por provedor.

## Logs

A página de logs tem duas abas com fontes de dados independentes:

| Tipo | Registra | Uso |
| --- | --- | --- |
| Log de mensagens (`message_logs`) | Texto da conversa, direção, persona, bot, usuário | Revisar "o que foi dito"; também é fonte de estatísticas e resumos de memória |
| Log de execução (`system_logs`) | Nível, categoria, etapa, duração, detalhe estruturado | Investigar "o que aconteceu, quanto tempo levou e por que falhou" |

Os logs de execução cobrem:

- Início e fim da geração de resposta (persona, provedor, modelo, tamanho do histórico, presença de imagens, entrada do usuário);
- Cada requisição e resposta ao modelo (`apiBase`, temperatura, tokens máximos, número de mensagens, caracteres, duração, usage);
- Nova tentativa com fallback de visão após o provedor recusar imagens;
- Nova tentativa com instrução forçada após a barreira de estado disparar;
- Testes de conectividade, descoberta de modelos e varreduras de visão;
- Nome, mensagem e stack do erro quando a geração falha.

Ambos os logs permitem filtrar por persona, usuário, palavra-chave e intervalo de datas, paginar e exportar em JSON / Markdown. Os logs de mensagens filtram também por direção, e os de execução por nível e categoria. O filtro de usuário é um dropdown agregado a partir dos logs existentes.

## Memória e conversas

- **Memória em camadas**: memórias diária / de três dias / quinzenal / mensal são condensadas camada por camada, junto com perfis de usuário e fatos atômicos.
- **Memória central**: acordos, preferências e fatos acima de um limite de importância entram em uma área protegida e são injetados separadamente, então editar arquivos nunca os perde.
- **Recuperação de memória relevante**: trechos são buscados a partir da entrada atual e dos assuntos pendentes para evitar injeção total.
- **Arquivos de memória incrementais**: se o conteúdo não mudou em relação ao turno anterior, apenas um marcador é injetado, economizando tokens.
- **Fatos em tempo real**: acordos, preferências e informações importantes detectados durante a conversa são gravados imediatamente na memória de longo prazo e valem a partir do próximo turno.
- **Governança de conversas**: uma janela deslizante mantém as últimas N rodadas na íntegra e as anteriores viram resumo rolante; quando uma sessão expira, os pontos de longo prazo migram para a memória central antes de abrir uma nova sessão, para que a memória não se perca com o cache.
- **Barreira de estado**: intercepta e repete respostas do tipo "vai dormir" quando, por exemplo, as tarefas ainda não terminaram.

## Filtro de palavras-chave (opcional)

Ative em "Configurações → Filtro de palavras-chave". A lista é separada por quebras de linha, vírgulas ou ponto e vírgula. Quando uma mensagem do usuário corresponde:

- **Bloquear**: a mensagem não chega ao modelo e um aviso fixo é retornado;
- **Substituir por \***: as palavras correspondentes são trocadas pelo mesmo número de asteriscos e a conversa continua.

Desativado por padrão. É um filtro operacional básico, não moderação de conteúdo.

## Anexos de IA aos arquivos de memória (opcional)

Os três arquivos de memória (`MEMORY.md` / `USER.md` / `persona-state.md`) deixam de ser sobrescritos automaticamente assim que são editados manualmente. Se quiser que a IA continue acumulando memória sem destruir seu texto:

1. Ative o interruptor global em "Configurações → Anexos de IA aos arquivos de memória";
2. Na página de memória, selecione um arquivo e ative "Permitir anexos de IA" nos que você editou manualmente.

Com isso ativado, a tarefa diária de memória anexa o conteúdo novo do dia à seção `<!-- AI:APPEND -->` no fim do arquivo:

- Seu texto original (antes do marcador) nunca é alterado;
- O conteúdo anexado é deduplicado linha a linha;
- Desligar o interruptor do arquivo interrompe os anexos e mantém o original e o que já foi anexado.

## Qualidade e testes

```bash
# Verificação de tipos (server + admin)
pnpm -r typecheck

# Testes unitários (node:test; cobre relógio, divisão de texto, barreira de estado, filtro de palavras-chave, contexto e memória, configuração de provedores, logs de execução e limitação de tentativas)
pnpm test

# Build
pnpm build
```

A CI está em `.github/workflows/ci.yml` e executa typecheck, test e build a cada push e pull request.

## Segurança

- **Proteção de segredos padrão**: com `NODE_ENV=production`, o servidor se recusa a iniciar se `ADMIN_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY` ainda estiverem com os valores padrão; no desenvolvimento apenas avisa.
- **Hash da senha de administrador (opcional)**: definir `ADMIN_PASSWORD_HASH` (`scrypt$salt$hash`) tem prioridade sobre a senha em texto puro e compara em tempo constante. Gere com:

```bash
node packages/server/dist/scripts/hash-password.js "sua-senha"
```

- **Criptografia de campos sensíveis**: ClientSecret do QQ, chaves de LLM, chaves de desenho e tokens do GitHub são armazenados com AES-256-GCM; a API apenas informa se estão configurados e nunca devolve texto puro.
- **Autenticação**: todos os endpoints, exceto login e health check, exigem sessão, via `Authorization: Bearer` (API) ou cookie httpOnly (recarregamento do navegador); cookies usam `Secure` em produção.
- **Limite de tentativas de login**: no máximo 10 tentativas por IP em 15 minutos.
- **CORS desativado por padrão**: implantação na mesma origem não precisa de CORS; para acesso cruzado, liste as origens permitidas em `CORS_ORIGINS`, para que credenciais nunca sejam refletidas para origens arbitrárias.
- **Bloqueio de comandos do agente de servidor**: uma lista negra integrada de comandos catastróficos (formatação, escrita direta em dispositivo de bloco, desligamento, exclusão recursiva da raiz, limpeza de firewall e semelhantes) é recusada mesmo com o agente ativado.
- **Timeouts de rede**: todas as requisições externas (QQ / LLM / desenho / GitHub / download de anexos) têm timeout para evitar conexões travadas e vazamentos de memória.
- **Mascaramento de logs**: o logger Pino mascara `clientSecret` / `apiKey` / `password` e campos semelhantes; os logs de execução guardam metadados da requisição, durações e causas de erro, e podem incluir trechos da conversa para facilitar o diagnóstico.

## Backups

O SQLite usa `VACUUM INTO` para gerar snapshots online consistentes sem parar o serviço. Os 10 mais recentes ficam em `data/backups/`:

```bash
# Fazer backup mantendo os 10 mais recentes
pnpm --filter @personabot/server backup

# Quantidade de retenção personalizada
node packages/server/dist/scripts/backup.js 20
```

## Modelo de dados

| Tabela | Descrição |
| --- | --- |
| `bots` | Instâncias de bot do QQ; ClientSecret criptografado e persona vinculada |
| `personas` | Pacotes de definição de persona (prompt / traços / habilidades / comandos / desenho / configuração de modelo) |
| `models` | Configuração de modelos LLM (provedor / chave de API / base / temperatura / tokens máximos / visão / ativo) |
| `providers` | Configuração por provedor (nome / base / chave criptografada); provedores vazios são permitidos |
| `memories` | Memórias em camadas (daily / three_day / biweekly / monthly) |
| `conversations` | Histórico de conversas (somente anexar para reaproveitar o prefixo em cache) |
| `user_profiles` | Perfis de hábitos do usuário |
| `stats` | Estatísticas diárias (tokens / acertos de cache / imagens / número de mensagens) |
| `message_logs` | Fluxo de mensagens (fonte de estatísticas e resumos de memória) |
| `system_logs` | Logs de execução (nível / categoria / etapa / duração / detalhe estruturado, com índices) |
| `token_usage` | Detalhe do uso de tokens por chamada |
| `painting_logs` | Registros de desenho e base das cotas diárias |
| `skills` | Plugins de habilidades (integrados / personalizados / sincronizados com GitHub) |
| `settings` | Configurações do sistema em chave-valor |

As migrações ficam em `packages/server/src/db/migrate.ts`. Executam na ordem dos ids e são registradas em `_migrations`, portanto podem ser repetidas com segurança.

## Visão geral da API REST

| Grupo | Endpoints |
| --- | --- |
| Autenticação | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Bots | `GET/POST /api/bots`, `PUT/DELETE /api/bots/:id`, `POST /api/bots/:id/toggle|restart`, `GET /api/bots/status` |
| Personas | `GET/POST /api/personas`, `PUT/DELETE /api/personas/:id`, `POST /api/personas/:id/simulate` |
| Modelos | `GET/POST /api/models`, `POST /api/models/batch`, `PUT/DELETE /api/models/:id`, `POST /api/models/:id/test|discover`, `POST /api/models/discover`, `POST /api/models/vision-scan` |
| Provedores | `GET /api/models/providers`, `POST/PUT/DELETE /api/models/providers`, `POST /api/models/providers/discover` |
| Memória | `GET /api/memories`, `GET /api/memories/users`, `POST /api/memories/trigger|import`, `PUT/DELETE /api/memories/:id`, `GET/PUT /api/memories/file(s)`, `POST /api/memories/file/reset`, `PUT /api/memories/file/append` |
| Logs | `GET /api/logs`, `GET /api/logs/users`, `GET /api/logs/export`, `GET /api/logs/events`, `GET /api/logs/events/export` |
| Estatísticas | `GET /api/stats/dashboard|trends|persona/:id|messages` |
| Habilidades | `GET/POST /api/skills`, `PUT/DELETE /api/skills/:id`, `POST /api/skills/sync` |
| Configurações | `GET/PUT /api/settings`, `GET /api/system/info` |
| Operações | `POST /api/system/proactive/run|daily/run|tokens/refresh|bots/reload` |

Todos os endpoints, exceto `login` e `health`, exigem sessão (`Authorization: Bearer <token>` ou cookie).

## Tarefas agendadas

| Tarefa | Horário | Descrição |
| --- | --- | --- |
| Memória diária | Todo dia às 00:00 | Organiza as conversas do dia anterior em uma memória diária clara |
| Reset de estatísticas | Todo dia às 00:05 | As estatísticas do novo dia começam do zero |
| Memória de três dias | A cada 3 dias às 01:00 | Resume as memórias diárias dos últimos 3 dias |
| Memória condensada | A cada 2 semanas às 02:00 | Compacta duas semanas de memória |
| Memória mensal | Dia 1 de cada mês às 03:00 | Resume as memórias condensadas de duas semanas |
| Renovação de tokens | Todo dia às 04:00 | Renova access_tokens próximos do vencimento |
| Mensagens proativas | A cada 30 minutos | Iniciadas conforme os horários ativos do usuário e os traços da persona |
| Saudação diária | A cada 15 minutos | Enviada quando a janela ativa do usuário coincide e nada foi enviado naquele dia |
| Limpeza de memória | Todo dia às 04:30 | Limpa os contadores em memória das mensagens proativas |
| Sincronização de gateways | A cada 5 minutos | Sincroniza o estado de start/stop dos bots a partir do banco |
| Atualização de habilidades | Configurável | Busca as habilidades mais recentes no repositório do GitHub |

## Otimização de acertos de cache

1. Prefixo estável do System Prompt: a definição da persona vem primeiro e permanece idêntica byte a byte; conteúdo dinâmico, como hora e memória, vai no final.
2. Reutilização do prefixo de contexto por conversa: o mesmo usuário e persona sempre compartilham uma conversa.
3. Conjunto mínimo de ferramentas e histórico somente anexar: o histórico nunca é reescrito nem resumido novamente para turnos anteriores.
4. A compressão automática reutiliza o prefixo: resumos são anexados ao fim da lista de mensagens.
5. Métricas de cache: a página de estatísticas mostra `cacheRead / (input + cacheRead + cacheWrite)`.

## Implantação

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

O banco de dados fica em `data/`, os logs em `logs/`, e os segredos são gerenciados pelo `.env`.

## Teste local sem credenciais reais

1. Crie um cartão de provedor em "Modelos" (`provider = mock`, ou deixe vazio e não configure modelos para usar o Mock automaticamente) e adicione modelos conforme necessário.
2. Crie uma persona em "Personas", edite o prompt e clique em "Simular" para conversar localmente.
3. Acione manualmente a geração de memória diária / de três dias / mensal em "Memória" para verificar a injeção em camadas.
