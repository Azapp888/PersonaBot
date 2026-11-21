import { resolveProviderForPersona } from "../llm/factory";
import { memoryRepo } from "../db/repos/memories";
import { MEMORY_FILE_NAMES, readMemoryFile, writeMemoryFile } from "./service";
import { settingsService } from "../settings/service";
import { timeContextLine } from "../utils/clock";
import { logger } from "../logger";
import { truncate } from "../utils/json";
import type { ChatMessage, Persona } from "../types";

/**
 * 固定记忆模板。
 *
 * 这是「记忆档案」的稳定骨架：所有角色共用同一套栏目，便于人工阅读与长期维护。
 * 用户在记忆页点击「按模板整理」时，AI 只负责把已有记忆归位到这些栏目，不新增栏目。
 */
export const MEMORY_TEMPLATE = `# 记忆档案

## 一、基本资料
- 称呼：
- 身份 / 职业：
- 所在城市：
- 其他关键信息：

## 二、关系定位
- 关系类型：
- 称呼方式：
- 相处模式：

## 三、重要约定与承诺
- 

## 四、偏好与习惯
- 喜欢：
- 讨厌 / 忌讳：
- 作息与日常习惯：

## 五、重要事件时间线
- YYYY-MM-DD：

## 六、待办与未完成事项
- 

## 七、沟通注意事项
- 
`;

const TEMPLATE_SYSTEM = `你是一个记忆档案整理助手。请把下面的现有记忆整理成一份结构化「记忆档案」。

硬性要求：
1. 严格使用给定模板的七个栏目，栏目名称与顺序不得改变，不得新增或删除栏目；
2. 只整理已有信息：可以合并同类项、去重、按时间排序，但绝不能编造不存在的事实；
3. 每条信息尽量简短（一行一条），保留人名、地点、日期、约定、称呼、忌讳等关键细节；
4. 模板中的空栏目保留标题，内容写「（暂无）」；
5. 时间线按时间先后排列，日期未知的写在最后并标注「日期未知」；
6. 输出纯 Markdown 正文，不要代码块围栏，不要任何解释性文字。`;

export interface TemplateApplyResult {
  /** 写入（或预览）的目标记忆文件名。 */
  name: string;
  content: string;
  preview: boolean;
  /** 参与整理的来源文件。 */
  sources: string[];
}

/**
 * 用 AI 把当前记忆文件与原子事实按固定模板重新整理。
 *
 * - preview=true：只返回整理结果，不写盘，供前端预览确认；
 * - preview=false：写入 MEMORY.md，并标记为「手动编辑」，避免被自动总结覆盖。
 */
export async function reorganizeMemoryWithTemplate(
  persona: Persona,
  userId: string,
  opts: { preview?: boolean } = {},
): Promise<TemplateApplyResult> {
  const target = MEMORY_FILE_NAMES[0];
  const sources: string[] = [];
  const parts: string[] = [];

  for (const name of MEMORY_FILE_NAMES) {
    const content = readMemoryFile(persona.id, userId, name);
    if (content && content.trim()) {
      sources.push(name);
      parts.push(`### 文件：${name}\n${truncate(content, 6000)}`);
    }
  }

  const facts = memoryRepo.listByUser(persona.id, userId);
  if (facts.length) {
    sources.push(`结构化记忆 ${facts.length} 条`);
    const lines = facts
      .slice(0, 200)
      .map((m) => `- [${m.sourceDate}][重要性 ${m.importance}${m.pinned ? " 永久" : ""}] ${m.content}`);
    parts.push(`### 结构化记忆（原子事实 / 分层记忆）\n${lines.join("\n")}`);
  }

  if (!parts.length) {
    return {
      name: target,
      content: MEMORY_TEMPLATE,
      preview: true,
      sources,
    };
  }

  const settings = settingsService.get();
  const messages: ChatMessage[] = [
    { role: "system", content: TEMPLATE_SYSTEM },
    {
      role: "user",
      content: [
        timeContextLine(settings.timezone),
        "以下模板是要生成的记忆档案骨架：",
        "```markdown",
        MEMORY_TEMPLATE,
        "```",
        `角色：${persona.name}；用户：${userId}`,
        "现有记忆材料：",
        parts.join("\n\n"),
      ].join("\n\n"),
    },
  ];

  const { provider } = resolveProviderForPersona(persona);
  const result = await provider.chat(messages, { temperature: 0.2, maxTokens: 2000 });
  const content = result.content.trim();
  if (!content) {
    throw new Error("模型没有返回整理结果");
  }

  if (opts.preview) {
    return { name: target, content, preview: true, sources };
  }

  writeMemoryFile(persona, userId, target, content);
  logger.info({ personaId: persona.id, userId, sources: sources.length }, "memory files reorganized with template");
  return { name: target, content, preview: false, sources };
}
