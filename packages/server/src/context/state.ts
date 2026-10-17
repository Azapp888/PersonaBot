/**
 * 状态机与守卫（Guardrails）：
 * 在代码层追踪用户的“当前状态”，防止大模型记忆漂移后无脑催睡。
 * 例如：作业未完成时，强制模型协助拆解任务，而不是劝用户休息。
 */

export interface ConversationState {
  /** 作业是否仍未完成 */
  homeworkUnfinished: boolean;
  /** 尚未完成的科目 */
  pendingSubjects: string[];
  /** 已确认完成的科目 */
  completedSubjects: string[];
  /** 当前情绪 / 身体状态关键词 */
  mood: string[];
  /** 长期记忆点（约定、计划、纪念日等） */
  longTermPoints: string[];
  /** 会话开始时间戳（毫秒） */
  sessionStartedAt: number;
  updatedAt: number;
}

export function emptyState(): ConversationState {
  return {
    homeworkUnfinished: false,
    pendingSubjects: [],
    completedSubjects: [],
    mood: [],
    longTermPoints: [],
    sessionStartedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const SUBJECTS = ["物理", "英语", "数学", "语文", "化学", "生物", "历史", "地理", "政治"];

const UNFINISHED_RE =
  /(没写完|没写|还没写|没有写|写不完|没做完|没完成|做不完|没做完|没有做|不会做|做不出|没开始|还没动|没弄完|没搞定|老是拖|拖延|欠着|还没做完|还有.*没|作业没|没写完作业)/;

const GENERIC_DONE_RE = /(都写完了|全都写完|都做完了|全都做完|作业写完|完成作业|全部完成|全都完成|总算写完|写完啦|写完咯)/;
const SUBJECT_DONE_RE = /(写完|做完|写好|完成|搞定|结束|交上|交了|复习完|背完|写完啦|做完啦)/;

const MOOD_MAP: { re: RegExp; label: string }[] = [
  { re: /(好累|很累|太累|累死|疲惫|乏了|没劲|身心俱疲)/, label: "疲惫" },
  { re: /(焦虑|紧张|心慌|压力大|压力好大|喘不过气)/, label: "焦虑" },
  { re: /(烦|烦躁|抑郁|难受|崩溃|emo|想哭|委屈)/, label: "情绪低落" },
  { re: /(困|好困|想睡|睁不开眼|熬夜|没睡好|失眠)/, label: "困倦" },
  { re: /(开心|高兴|兴奋|快乐|笑死|好耶)/, label: "开心" },
  { re: /(家人|妈妈|爸爸|奶奶|爷爷|住院|生病|手术|去世)/, label: "家庭牵挂" },
];

const LONGTERM_RE = /(约定|约好|说好|答应|计划|打算|周末|下次|以后|一起去|一起去看|纪念日|生日|记得|别忘|一定要)/;

/** 命中“催促休息”的违规词，作业未完成时禁止出现 */
const BANNED_RE = /(去睡|睡觉吧|早点休息|早点睡|快去睡|该睡了|该休息了|先睡吧|先睡啦|先睡了|睡吧|快睡|休息吧|早点睡吧|明天再说|明天再写|明天再弄|醒来再写)/;

export function detectSubjects(text: string): string[] {
  return SUBJECTS.filter((s) => text.includes(s));
}

function extractMood(text: string): string[] {
  return MOOD_MAP.filter((m) => m.re.test(text)).map((m) => m.label);
}

function extractLongTermPoints(prev: string[], text: string): string[] {
  const sentences = text
    .split(/[。！？!?；;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const points = sentences.filter((s) => LONGTERM_RE.test(s) && s.length <= 60);
  const merged = [...prev];
  for (const p of points) {
    if (!merged.includes(p)) merged.push(p);
  }
  return merged.slice(-8);
}

function mergeUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

function splitClauses(text: string): string[] {
  return text
    .split(/[。！？!?；;，,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 会话是否已超时：距上次更新的间隔超过 timeoutMs 即视为新会话。
 * 时间基准取 sessionStartedAt 与 updatedAt 的较大值，避免长期未更新导致的误判。
 */
export function isSessionExpired(state: ConversationState, timeoutMs: number, at = Date.now()): boolean {
  if (timeoutMs <= 0) return false;
  const last = Math.max(state.sessionStartedAt || 0, state.updatedAt || 0);
  if (!last) return false;
  return at - last >= timeoutMs;
}

/**
 * 开启新会话：清空会话级缓存（情绪、待办科目、长期记忆点）并重置会话起点。
 * 长期记忆点建议由调用方先迁移到核心记忆，再调用本函数清理。
 */
export function startNewSession(state: ConversationState, at = Date.now()): ConversationState {
  return {
    ...state,
    homeworkUnfinished: false,
    pendingSubjects: [],
    completedSubjects: [],
    mood: [],
    longTermPoints: [],
    sessionStartedAt: at,
    updatedAt: at,
  };
}

/**
 * 用一条用户输入更新状态。按分句分析，避免“没写完”里的“写完”被误判为完成。
 * - 未完成语句 -> homeworkUnfinished=true，识别到的科目进入待完成列表；
 * - 完成语句 -> 对应科目移出待完成、记入已完成；
 * - 无科目的“写完了” -> 视为完成泛化“作业”。
 * - 最终 homeworkUnfinished 由“待完成列表是否为空”推导，保证状态收敛。
 */
export function updateState(prev: ConversationState, text: string): ConversationState {
  const state: ConversationState = {
    ...prev,
    pendingSubjects: [...prev.pendingSubjects],
    completedSubjects: [...prev.completedSubjects],
    mood: [...prev.mood],
    longTermPoints: [...prev.longTermPoints],
    sessionStartedAt: prev.sessionStartedAt,
    updatedAt: Date.now(),
  };

  const doneAll = GENERIC_DONE_RE.test(text);

  if (doneAll) {
    state.completedSubjects = mergeUnique(state.completedSubjects, state.pendingSubjects);
    state.pendingSubjects = [];
  } else {
    for (const clause of splitClauses(text)) {
      const subjects = detectSubjects(clause);
      const unfinished = UNFINISHED_RE.test(clause);

      if (unfinished) {
        const add = subjects.length ? subjects : ["作业"];
        state.pendingSubjects = mergeUnique(state.pendingSubjects, add);
        state.completedSubjects = state.completedSubjects.filter((c) => !add.includes(c));
        continue;
      }

      if (SUBJECT_DONE_RE.test(clause)) {
        if (subjects.length) {
          for (const s of subjects) {
            state.pendingSubjects = state.pendingSubjects.filter((p) => p !== s);
            state.completedSubjects = mergeUnique(state.completedSubjects, [s]);
          }
        } else {
          state.pendingSubjects = state.pendingSubjects.filter((p) => p !== "作业");
        }
      }
    }
  }

  // 状态收敛：有待完成科目即未完成，否则已完成
  if (state.pendingSubjects.length > 1) {
    state.pendingSubjects = state.pendingSubjects.filter((s) => s !== "作业");
  }
  state.homeworkUnfinished = state.pendingSubjects.length > 0;

  state.mood = mergeUnique(state.mood, extractMood(text)).slice(-6);
  state.longTermPoints = extractLongTermPoints(state.longTermPoints, text);

  return state;
}

/** 生成强制系统指令；作业已完成时返回 null。 */
export function buildGuardrail(state: ConversationState, personaName: string): string | null {
  if (!state.homeworkUnfinished) return null;
  const subjects = state.pendingSubjects.filter((s) => s && s !== "作业");
  const subjectText = subjects.length ? subjects.join("、") : "当前作业";
  const moodText = state.mood.length ? `用户当前情绪：${state.mood.join("、")}。` : "";
  return [
    "【系统强制警告｜最高优先级，覆盖角色设定中任何“体贴劝睡”的倾向】",
    `你正以「${personaName}」的身份陪伴用户。用户当前作业未完成（科目：${subjectText}）。${moodText}`,
    `禁止输出任何“去睡吧、早点休息、早点睡、明天再说、明天再写、休息吧”之类的词汇或等价表达。`,
    `必须直接帮用户拆解${subjectText}的当前任务：先安抚情绪，再给出具体、可执行的小步骤，陪伴用户完成。`,
    `注意：不要臆造用户未提到的信息；若不确定进度，先追问“${subjectText}现在写到哪一步/卡在哪里”。`,
  ].join("\n");
}

/** 作业未完成时，回复中是否出现违规催睡词。 */
export function violatesGuardrail(reply: string, state: ConversationState): boolean {
  if (!state.homeworkUnfinished) return false;
  return BANNED_RE.test(reply);
}

/** 重试仍违规时的兜底：删除包含违规词的句子。 */
export function sanitizeReply(reply: string): string {
  const sentences = reply
    .split(/(?<=[。！？!?~])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = sentences.filter((s) => !BANNED_RE.test(s));
  const result = kept.join("");
  if (result.trim().length >= 4) return result.trim();
  return `先别急着休息，我们把眼前的搞定。你现在卡在哪一步了？我陪你一步步拆开。`;
}

/** 供 System Prompt 渲染的当前状态文本。 */
export function renderState(state: ConversationState): string {
  const lines: string[] = [];
  if (state.homeworkUnfinished) {
    const subjects = state.pendingSubjects.length ? state.pendingSubjects.join("、") : "有";
    lines.push(`- 作业：未完成（${subjects}）—— 严禁催促休息，必须协助拆解任务`);
  }
  if (state.completedSubjects.length) lines.push(`- 已完成：${state.completedSubjects.join("、")}`);
  if (state.mood.length) lines.push(`- 情绪/身体：${state.mood.join("、")}`);
  if (state.longTermPoints.length) lines.push(`- 长期记忆点：${state.longTermPoints.join("；")}`);
  return lines.join("\n");
}
