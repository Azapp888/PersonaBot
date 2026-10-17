/** 内置提供商预设 id（provider 字段本身是自由字符串，预设仅用于快速选择）。 */
export type BuiltinProvider =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "volcengine"
  | "google"
  | "dashscope"
  | "moonshot"
  | "zhipu"
  | "minimax"
  | "qianfan"
  | "tencent"
  | "spark"
  | "xai"
  | "openrouter"
  | "siliconflow"
  | "custom"
  | "mock";

/** 提供商标识：内置预设或用户自定义名称。 */
export type ModelProvider = BuiltinProvider | (string & {});
export type MemoryType = "daily" | "three_day" | "biweekly" | "monthly" | "imported" | "fact";

export type MemoryKind = "agreement" | "preference" | "fact" | "event" | "trivial";

export interface ProactiveRunResult {
  ok: boolean;
  enabled: boolean;
  forced: boolean;
  personas: number;
  profiles: number;
  sent: number;
  details: { personaId: string; personaName: string; userId: string; content: string }[];
  skipped: { persona: string; userId: string; reason: string }[];
  errors: string[];
}

export interface SystemTime {
  now: number;
  iso: string;
  formatted: string;
  date: string;
  time: string;
  weekday: string;
  timezone: string;
  utcOffsetMinutes: number;
}

export interface Personality {
  traits: string[];
  speakingStyle: string;
  catchphrases: string[];
  emotionalTendency: string;
  canPaint?: boolean;
}

export interface PersonaCommand {
  name: string;
  trigger: string;
  description: string;
  prompt: string;
}

export interface PaintingConfig {
  enabled: boolean;
  style: string;
  artistReference: string;
  characterDna: string;
  provider?: string;
  model?: string;
}

export interface Persona {
  id: string;
  name: string;
  avatar: string | null;
  description: string;
  systemPrompt: string;
  personality: Personality;
  skills: string[];
  commands: PersonaCommand[];
  paintingConfig: PaintingConfig;
  scheduleTemplate: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleSegment {
  start: string;
  end: string;
  activity: string;
  note: string;
}

export interface PersonaSchedule {
  personaId: string;
  date: string;
  segments: ScheduleSegment[];
  createdAt: number;
}

export interface Bot {
  id: string;
  name: string;
  appId: string;
  personaId: string | null;
  personaName: string | null;
  modelId: string | null;
  modelName?: string | null;
  enabled: boolean;
  agentEnabled: boolean;
  clientSecretSet: boolean;
  tokenExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  gatewayState?: string;
  lastError?: string | null;
  connectedAt?: number | null;
}

export interface ModelRecord {
  id: string;
  name: string;
  provider: ModelProvider;
  apiBase: string | null;
  modelId: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  supportsVision: boolean;
  apiKeySet: boolean;
  /** 按「提供商地址」归类的派生字段 */
  providerKey?: string;
  providerLabel?: string;
  providerAddr?: string;
  providerKnown?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderGroup {
  key: string;
  label: string;
  addr: string;
  vendor: string;
  known: boolean;
  models: number;
  credentials: number;
  visionModels: number;
}

export interface DiscoveredModel {
  id: string;
  created?: number | null;
  ownedBy?: string | null;
}

export interface Memory {
  id: string;
  personaId: string;
  userId: string;
  type: MemoryType;
  content: string;
  sourceDate: string;
  importance: number;
  pinned: boolean;
  kind: MemoryKind;
  origin: "daily" | "realtime";
  consolidatedInto: string | null;
  createdAt: number;
}

export interface MessageLog {
  id: string;
  time: number;
  iso: string;
  direction: "in" | "out";
  userId: string;
  personaId: string | null;
  personaName: string | null;
  botId: string | null;
  botName: string | null;
  content: string;
}

export interface LogPage {
  total: number;
  limit: number;
  offset: number;
  items: MessageLog[];
}

export interface LogFilterParams {
  personaId?: string;
  userId?: string;
  direction?: string;
  q?: string;
  since?: number;
  until?: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  type: "builtin" | "custom" | "github";
  version: string;
  source: string | null;
  content: string;
  enabled: boolean;
  updatedAt: number;
}

export interface AppSettings {
  adminPort: number;
  botServiceNote: string;
  cacheEnabled: boolean;
  memoryInjectConversationLimit: number;
  paintingGlobalDailyLimit: number;
  paintingPersonaDailyLimit: number;
  paintingEnabled: boolean;
  paintingProvider: string;
  paintingApiBase: string;
  paintingApiKey?: string;
  paintingApiKeySet?: boolean;
  paintingModel: string;
  paintingSize: string;
  proactiveEnabled: boolean;
  proactiveMaxMessages: number;
  skillRepoUrl: string;
  skillBranch: string;
  githubToken?: string;
  githubTokenSet?: boolean;
  skillUpdateCron: string;
  messageDebounceMs: number;
  splitMessages: boolean;
  splitMaxMessages: number;
  timezone: string;
  dailyMessageEnabled: boolean;
  dailyMessageHour: number;
  dailyMessageMaxPerDay: number;
  dailyMessageMinGapMinutes: number;
  contextRecentRounds: number;
  contextSummaryEnabled: boolean;
  conversationMaxMessages: number;
  guardrailEnabled: boolean;
  fileHandlingEnabled: boolean;
  fileMaxBytes: number;
  agentShellPrefix: string;
  agentShellTimeoutMs: number;
  agentShellMaxOutputChars: number;
  agentShellAllowedUsers: string;
  keywordFilterEnabled: boolean;
  keywordFilterAction: string;
  keywordFilterWords: string;
  memoryFileAppendEnabled: boolean;
  memoryDailyRetainDays: number;
  memoryCoreImportance: number;
  memoryCoreMaxFacts: number;
  realtimeFactEnabled: boolean;
  scheduleEnabled: boolean;
  scheduleGenerateHour: number;
  updateRepoUrl: string;
  updateBranch: string;
  visionFallbackModelId: string;
}

export interface UpdateInfo {
  available: boolean;
  ok: boolean;
  mode: "git" | "docker" | "unknown";
  repoRoot: string | null;
  repoUrl: string | null;
  branch: string;
  currentCommit: string | null;
  currentCommitDate: string | null;
  remoteCommit: string | null;
  remoteCommitDate: string | null;
  behind: number;
  ahead: number;
  remoteMessage: string | null;
  message: string;
  guidance: string | null;
  canAutoUpdate: boolean;
}

export interface UpdateStep {
  name: string;
  ok: boolean;
  output: string;
}

export interface UpdateResult {
  ok: boolean;
  mode: "git" | "docker" | "unknown";
  steps: UpdateStep[];
  message: string;
  previousCommit: string | null;
  newCommit: string | null;
  restartRequired: boolean;
  guidance: string | null;
}

export interface DashboardData {
  date: string;
  tokenConsumed: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheHitRate: number;
  imagesGenerated: number;
  messages: number;
  activeBots: number;
  totalBots: number;
  totalPersonas: number;
  perPersona: { personaId: string; name: string; tokens: number; messages: number; images: number }[];
  perBot: { botId: string; name: string; messages: number }[];
}

export interface TrendPoint {
  date: string;
  tokens: number;
  images: number;
  messages: number;
  cacheHitRate: number;
}
