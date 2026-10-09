export type ModelProvider = "openai" | "deepseek" | "anthropic" | "mock" | "custom";
export type MemoryType = "daily" | "three_day" | "biweekly" | "monthly";

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

export interface ModelConfig {
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
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
  modelConfig: ModelConfig;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Bot {
  id: string;
  name: string;
  appId: string;
  personaId: string | null;
  personaName: string | null;
  enabled: boolean;
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
  apiKeySet: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Memory {
  id: string;
  personaId: string;
  userId: string;
  type: MemoryType;
  content: string;
  sourceDate: string;
  createdAt: number;
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
