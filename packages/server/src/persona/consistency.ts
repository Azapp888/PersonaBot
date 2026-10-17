import type { Persona } from "../types";

/**
 * 人格一致性校验：在人物设定进入运行前，静态检查其是否自洽、信息是否完整。
 *
 * 这里的检查全部是「确定性、可离线执行」的规则，不依赖 LLM：
 * 目的不是评判人设好坏，而是捕捉那些会导致模型行为漂移或注入空洞的明显问题，
 * 例如：情绪倾向与性格标签冲突、说话风格与口癖互相矛盾、必备字段为空等。
 */

export type ConsistencyLevel = "error" | "warning" | "info";

export interface ConsistencyIssue {
  /** 问题归类，便于前端分组与筛选 */
  code: string;
  level: ConsistencyLevel;
  /** 面向用户的一句话说明 */
  message: string;
  /** 可选的修复建议 */
  hint?: string;
}

export interface ConsistencyReport {
  personaId: string;
  /** 0-100，越高越一致；error 扣 25，warning 扣 8，info 扣 2。 */
  score: number;
  errors: number;
  warnings: number;
  issues: ConsistencyIssue[];
}

/** 情绪/性格的极性词表：同一极性内的词彼此相容，跨极性即视为语义相反。 */
const POSITIVE_TERMS = /开朗|阳光|乐观|活泼|热情|温柔|体贴|耐心|温和|冷静|理性|沉稳|积极|友好|善良|安静|内敛|细腻/;
const NEGATIVE_TERMS = /阴郁|悲观|冷淡|消极|内向|暴躁|易怒|刻薄|冷漠|冲动|急躁|情绪化|多愁善感|孤僻/;

/** 描述 a 与描述 b 是否语义相反（一正一负）。 */
function pairs(a: string, b: string): boolean {
  if (!a || !b) return false;
  return (POSITIVE_TERMS.test(a) && NEGATIVE_TERMS.test(b)) || (NEGATIVE_TERMS.test(a) && POSITIVE_TERMS.test(b));
}

const STYLE_TONE_HINTS: [RegExp, RegExp, string][] = [
  [/活泼|俏皮|欢脱|可爱/, /正式|严肃|书面|古板/, "说话风格偏正式，与活泼的性格标签可能不协调"],
  [/冷淡|高冷|寡言/, /热情|话痨|健谈|活泼/, "说话风格偏冷淡，与热情的性格标签可能不协调"],
];

function norm(value: string): string {
  return (value || "").trim();
}

/**
 * 校验单个角色设定的一致性。
 * 返回确定性的问题清单与评分，供后台展示与运行前提示。
 */
export function checkPersonaConsistency(persona: Persona): ConsistencyReport {
  const issues: ConsistencyIssue[] = [];
  const p = persona.personality ?? ({} as Persona["personality"]);
  const traits = (p.traits ?? []).map(norm).filter(Boolean);
  const catchphrases = (p.catchphrases ?? []).map(norm).filter(Boolean);

  // 1) 必备字段完整性
  if (!norm(persona.name)) {
    issues.push({ code: "missing_name", level: "error", message: "角色缺少名称", hint: "补充角色名称后再启用" });
  }
  if (!norm(persona.description) && !norm(persona.systemPrompt)) {
    issues.push({
      code: "missing_identity",
      level: "error",
      message: "角色既无简介也无系统提示词",
      hint: "至少填写角色简介或系统提示词，否则模型无法稳定扮演",
    });
  }
  if (traits.length === 0) {
    issues.push({ code: "no_traits", level: "warning", message: "未设置任何性格标签", hint: "建议填写 3-5 个性格标签" });
  }
  if (!norm(p.speakingStyle)) {
    issues.push({ code: "no_speaking_style", level: "warning", message: "未设置说话风格", hint: "说话风格能显著提升角色辨识度" });
  }
  if (!norm(p.emotionalTendency)) {
    issues.push({ code: "no_mood", level: "info", message: "未设置情绪倾向" });
  }

  // 2) 性格标签之间的冲突
  for (let i = 0; i < traits.length; i++) {
    for (let j = i + 1; j < traits.length; j++) {
      if (pairs(traits[i], traits[j])) {
        issues.push({
          code: "trait_conflict",
          level: "warning",
          message: `性格标签「${traits[i]}」与「${traits[j]}」语义相反`,
          hint: "保留更贴近设定的一方，避免模型在扮演时前后矛盾",
        });
      }
    }
  }

  // 3) 情绪倾向与性格标签冲突
  const mood = norm(p.emotionalTendency);
  for (const trait of traits) {
    if (mood && pairs(trait, mood)) {
      issues.push({
        code: "mood_trait_conflict",
        level: "warning",
        message: `情绪倾向「${mood}」与性格标签「${trait}」可能冲突`,
        hint: "确认两者是否应该同时存在",
      });
    }
  }

  // 4) 说话风格与性格标签的语感错配（双向匹配）
  const style = norm(p.speakingStyle);
  for (const [styleRe, traitRe, message] of STYLE_TONE_HINTS) {
    const forward = styleRe.test(style) && traits.some((t) => traitRe.test(t));
    const backward = traitRe.test(style) && traits.some((t) => styleRe.test(t));
    if (forward || backward) {
      issues.push({ code: "style_tone_mismatch", level: "info", message });
    }
  }

  // 5) 口癖与说话风格矛盾（口癖常是简短拟声，风格却描述为严肃书面）
  if (catchphrases.length && /正式|严肃|书面|古板/.test(style) && catchphrases.some((c) => c.length <= 3)) {
    issues.push({
      code: "catchphrase_style_mismatch",
      level: "info",
      message: "口癖偏口语化，与正式的说话风格可能不协调",
    });
  }

  // 6) 重复项
  if (new Set(traits).size !== traits.length) {
    issues.push({ code: "duplicate_traits", level: "info", message: "存在重复的性格标签" });
  }
  if (new Set(catchphrases).size !== catchphrases.length) {
    issues.push({ code: "duplicate_catchphrases", level: "info", message: "存在重复的口癖" });
  }

  // 7) 命令配置完整性
  for (const cmd of persona.commands ?? []) {
    if (!norm(cmd.trigger) || !norm(cmd.prompt)) {
      issues.push({
        code: "incomplete_command",
        level: "warning",
        message: `命令「${norm(cmd.name) || "未命名"}」缺少触发词或提示词`,
        hint: "补全触发词与提示词后再启用该命令",
      });
    }
  }

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  const score = Math.max(0, 100 - errors * 25 - warnings * 8 - (issues.length - errors - warnings) * 2);

  return { personaId: persona.id, score, errors, warnings, issues };
}

/** 汇总多个角色的一致性，供 Dashboard 概览。 */
export interface ConsistencySummary {
  total: number;
  healthy: number;
  withErrors: number;
  withWarnings: number;
  averageScore: number;
  worst: { personaId: string; name: string; score: number; issueCount: number }[];
}

export function summarizeConsistency(personas: Persona[], limit = 5): ConsistencySummary {
  const reports = personas.map((p) => ({ persona: p, report: checkPersonaConsistency(p) }));
  const total = reports.length;
  const healthy = reports.filter((r) => r.report.issues.length === 0).length;
  const withErrors = reports.filter((r) => r.report.errors > 0).length;
  const withWarnings = reports.filter((r) => r.report.warnings > 0).length;
  const averageScore = total
    ? Number((reports.reduce((s, r) => s + r.report.score, 0) / total).toFixed(1))
    : 100;
  const worst = [...reports]
    .sort((a, b) => a.report.score - b.report.score || a.persona.name.localeCompare(b.persona.name))
    .slice(0, limit)
    .map((r) => ({
      personaId: r.persona.id,
      name: r.persona.name,
      score: r.report.score,
      issueCount: r.report.issues.length,
    }));
  return { total, healthy, withErrors, withWarnings, averageScore, worst };
}
