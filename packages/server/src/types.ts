// 全量领域类型定义（后端）

export interface Bot {
  id: string;
  name: string;
  appId: string;
  clientSecret: string; // 加密存储
  accessToken: string | null;
  tokenExpiresAt: number | null;
  personaId: string | null;
  /** 该 Bot 使用的模型（引用 models 表）。为空时回退到角色上的模型配置。 */
  modelId: string | null;
  enabled: boolean;
  agentEnabled: boolean; // 是否启用「服务器本地 Agent（可运行 shell 命令）」
  /** 该 Bot 是否启用主动消息（按 Bot 独立配置，不再有全局开关）。 */
  proactiveEnabled: boolean;
  /** 该 Bot 每个用户在一轮对话内最多主动发送的条数。 */
  proactiveMaxMessages: number;
  /** 是否允许模型自主调用联网搜索。 */
  searchEnabled: boolean;
  /** 使用哪个搜索提供商（search_providers.id），为空时用第一个启用的提供商。 */
  searchProviderId: string | null;
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
  /** 日程底稿（可选）：角色固定的作息规律，作为每日日程生成的基础。 */
  scheduleTemplate: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 每日日程中的单个时间段。 */
export interface ScheduleSegment {
  /** 起始时间 HH:mm */
  start: string;
  /** 结束时间 HH:mm */
  end: string;
  /** 该时段在做什么 */
  activity: string;
  /** 该时段的补充说明（状态/是否能回消息等，可空） */
  note: string;
}

/** 角色某一天的日程。 */
export interface PersonaSchedule {
  personaId: string;
  date: string;
  segments: ScheduleSegment[];
  createdAt: number;
}

/** 内置提供商预设 id（仅用于快速选择与默认地址，provider 字段本身是自由字符串）。 */
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

/**
 * 提供商标识。既可以是内置预设（见 BuiltinProvider），也可以是用户自定义名称。
 * 保留 string 以允许「用户自定义提供商名称」，不同地址的提供商不会被强制合并。
 */
export type ModelProvider = BuiltinProvider | (string & {});

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

export type MemoryType = "daily" | "three_day" | "biweekly" | "monthly" | "imported" | "fact";

/** 记忆条目的语义类别，用于区分「必须长期记住」与「可遗忘」。 */
export type MemoryKind = "agreement" | "preference" | "fact" | "event" | "trivial";

export interface Memory {
  id: string;
  personaId: string;
  userId: string;
  type: MemoryType;
  content: string;
  sourceDate: string;
  /** 重要性 1-10，写入时由 LLM 打分。 */
  importance: number;
  /** 是否受保护（永不剪枝 / 常驻注入）。约定、承诺、重要偏好默认受保护。 */
  pinned: boolean;
  kind: MemoryKind;
  /** 记忆来源：daily=每日整理，realtime=对话中实时提炼。 */
  origin: "daily" | "realtime";
  /** 已被哪条上层记忆浓缩吸收（用于剪枝追踪），未浓缩时为 null。 */
  consolidatedInto: string | null;
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
  image_url: {
    url: string;
    /** 仅 OpenAI 兼容协议使用：auto / low / high；Anthropic 会忽略该字段。 */
    detail?: "auto" | "low" | "high";
  };
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
  /** 当日已发送的每日问候条数。 */
  dailyCount: number;
  /** dailyCount 对应的日期（YYYY-MM-DD），跨天自动归零。 */
  dailyCountDate: string | null;
}

/**
 * 用户层身份：与「角色层」严格隔离，按 (personaId, userId) 存储。
 * 昵称、称呼权限、关系定义与个人边界只能来自这里，任何角色级提示词都不得写死具体用户。
 */
export interface UserIdentity {
  personaId: string;
  userId: string;
  /** 角色对该用户的称呼，例如「阿泽」。 */
  nickname: string;
  /** 用户真名（可选）。 */
  realName: string;
  /** 关系定义，例如「朋友」「异地恋男友」。 */
  relationship: string;
  /** 称呼权限：谁可以叫什么、哪些称呼禁用。 */
  addressPreference: string;
  /** 个人边界与禁忌。 */
  boundaries: string;
  updatedAt: number;
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
  /** 每个用户每天最多发送的每日问候条数。 */
  dailyMessageMaxPerDay: number;
  /** 同一用户两次每日问候之间的最小间隔（分钟）。 */
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
  /** 全局开关：允许 AI 在用户手动编辑过的记忆文件上自动追加内容（不改动原文）。 */
  memoryFileAppendEnabled: boolean;
  /** 日记忆保留天数：三日记忆生成后，更早的日记忆会被剪枝（原子事实不受影响）。 */
  memoryDailyRetainDays: number;
  /** 进入核心记忆（受保护区）的最低重要性，默认 8。 */
  memoryCoreImportance: number;
  /** 核心记忆注入条数上限。 */
  memoryCoreMaxFacts: number;
  /** 单个记忆文件注入 system prompt 的字节上限，超出部分按「保尾弃头」截断（默认 4096）。 */
  memoryFileMaxBytes: number;
  /** 记忆文件增量注入：内容与上一轮相同时只注入占位提示，避免重复占用 Token（默认开启）。 */
  memoryFileIncremental: boolean;
  /** 对话中实时提炼原子事实（约定/偏好/重要事件）并立即写入记忆，默认开启。 */
  realtimeFactEnabled: boolean;
  /** 每日为角色生成当日日程并注入 prompt，让角色行为符合身份，默认开启。 */
  scheduleEnabled: boolean;
  /** 每日生成日程的小时（0-23），默认 0（即 0 点前后）。 */
  scheduleGenerateHour: number;
  /** 一键更新：用于展示的仓库地址（实际以本地 git remote 为准）。 */
  updateRepoUrl: string;
  /** 一键更新：跟踪的分支，默认 main。 */
  updateBranch: string;
  /** 主模型不支持读图时，用于把图片转述为文本的视觉副模型（models 表 id）。留空则自动选择首个支持读图的模型。 */
  visionFallbackModelId: string;
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

/** 联网搜索返回的单条结果（已归一化为各厂商通用结构）。 */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 内置搜索提供商标识。 */
export type SearchVendor = "deepseek" | "volcengine" | "tavily" | "bocha" | "exa" | "serper";

/** 搜索提供商配置（密钥加密存储）。 */
export interface SearchProvider {
  id: string;
  vendor: SearchVendor;
  apiBase: string | null;
  /** 火山方舟等需要指定模型来执行搜索。 */
  model: string | null;
  apiKey: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
