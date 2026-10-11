// 全量领域类型定义（后端）

export interface Bot {
  id: string;
  name: string;
  appId: string;
  clientSecret: string; // 加密存储
  accessToken: string | null;
  tokenExpiresAt: number | null;
  personaId: string | null;
  enabled: boolean;
  agentEnabled: boolean; // 是否启用「服务器本地 Agent（可运行 shell 命令）」
  createdAt: number;
  updatedAt: number;
}

export interface Personality {
  traits: string[]; // 性格标签
  speakingStyle: string; // 说话风格
  catchphrases: string[]; // 口癖
  emotionalTendency: string; // 情绪倾向
  canPaint?: boolean; // 是否会画画
}

export interface PersonaCommand {
  name: string;
  trigger: string;
  description: string;
  prompt: string;
  behavior?: string;
}

export interface ModelConfig {
  modelId?: string; // 引用 models 表
  providerOverride?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface PaintingConfig {
  enabled: boolean;
  style: string; // 画风描述
  artistReference: string; // 画师参考
  characterDna: string; // 角色外观 DNA
  provider?: string; // 图片 Provider，默认取 settings
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
  modelConfig: ModelConfig;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ModelProvider = "openai" | "deepseek" | "anthropic" | "mock" | "custom";

export interface ModelRecord {
  id: string;
  name: string;
  provider: ModelProvider;
  apiKey: string | null; // 加密存储
  apiBase: string | null;
  modelId: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type MemoryType = "daily" | "three_day" | "biweekly" | "monthly" | "imported";

export interface Memory {
  id: string;
  personaId: string;
  userId: string;
  type: MemoryType;
  content: string;
  sourceDate: string;
  createdAt: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // 原始 JSON 字符串
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  timestamp?: number;
  /** assistant 消息携带的工具调用 */
  toolCalls?: ToolCall[];
  /** tool 消息对应的调用 id */
  toolCallId?: string;
}

export interface Conversation {
  id: string;
  personaId: string;
  userId: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface UserHabits {
  activeHours: string[];
  expressions: string[];
  interests: string[];
  emotionTriggers: string[];
  summary: string;
}

export interface UserProfile {
  id: string;
  userId: string;
  personaId: string;
  habits: UserHabits;
  lastInteractionAt: number | null;
  lastProactiveAt: number | null;
  lastDailyAt: number | null;
}

export interface DailyStats {
  date: string;
  personaId: string;
  tokenConsumed: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  imagesGenerated: number;
  messages: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  type: "builtin" | "custom" | "github";
  version: string;
  source: string | null; // github 地址
  content: string; // skill 注入内容 / prompt 片段
  enabled: boolean;
  updatedAt: number;
}

export interface SettingRecord {
  key: string;
  value: string;
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
  paintingApiKey: string;
  paintingModel: string;
  paintingSize: string;
  proactiveEnabled: boolean;
  proactiveMaxMessages: number;
  skillRepoUrl: string;
  skillBranch: string;
  githubToken: string;
  skillUpdateCron: string;
  messageDebounceMs: number;
  splitMessages: boolean;
  splitMaxMessages: number;
  timezone: string;
  dailyMessageEnabled: boolean;
  dailyMessageHour: number;
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
}

// LLM 相关
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
}

export interface LLMChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  signal?: AbortSignal;
}

export interface LLMChatResult {
  content: string;
  usage: LLMUsage;
  model: string;
  raw?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 参数定义 */
  parameters: Record<string, unknown>;
}

export interface LLMToolResult extends LLMChatResult {
  toolCalls: ToolCall[];
}

// QQ 事件
export interface QQAuthor {
  id: string; // openid / member_openid
  union_openid?: string;
  user_openid?: string;
}

export interface QQAttachment {
  url?: string;
  filename?: string;
  contentType?: string;
  size?: number;
}

export interface QQMessageEvent {
  id: string;
  type: "c2c" | "group" | "guild" | "direct";
  content: string;
  authorId: string; // 用户 openid
  msgId: string;
  groupOpenid?: string;
  guildId?: string;
  channelId?: string;
  timestamp: number;
  attachments?: QQAttachment[];
  raw?: unknown;
}

export interface QQReplyTarget {
  type: "c2c" | "group" | "guild" | "direct";
  userId?: string;
  groupOpenid?: string;
  guildId?: string;
  channelId?: string;
  msgId: string;
}
