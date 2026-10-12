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
  /** 该模型是否支持读取图片（多模态视觉）。 */
  supportsVision: boolean;
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
  /**
   * 文本内容，或包含文本与图片的多模态内容数组。
   * 历史/存储中始终使用字符串；图片仅在当前请求内以数组形式注入。
   */
  content: string | ContentPart[];
  name?: string;
  timestamp?: number;
  /** assistant 消息携带的工具调用 */
  toolCalls?: ToolCall[];
  /** tool 消息对应的调用 id */
  toolCallId?: string;
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  /** http(s) 远程图片地址，或 data:image/...;base64,... 数据地址 */
  image_url: { url: string };
}

export type ContentPart = TextContentPart | ImageContentPart;

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
  /** 全局开关：允许 AI 在用户手动编辑过的记忆文件上自动追加内容（不改动原文）。 */
  memoryFileAppendEnabled: boolean;
  /** 一键更新：用于展示的仓库地址（实际以本地 git remote 为准）。 */
  updateRepoUrl: string;
  /** 一键更新：跟踪的分支，默认 main。 */
  updateBranch: string;
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

/** 用户消息中的表情包 / emoji 标记（不单独回复，仅作为低权重上下文）。 */
export interface QQFace {
  /** 表情标识，例如 QQ 表情编号或 emoji 名称 */
  id: string;
  /** 表情文本占位（如 "[表情]"） */
  text: string;
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
  /** 消息中解析出的表情包标记 */
  faces?: QQFace[];
  /** 消息中的图片地址（来自 attachments 中 contentType 为 image/*） */
  imageUrls?: string[];
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
