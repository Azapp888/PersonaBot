import { personaRepo } from "../db/repos/personas";
import { userIdentityRepo } from "../db/repos/user-identities";
import { sanitizeRoleLayer } from "../persona/prompt";
import { logger } from "../logger";

/**
 * 一次性清洗角色层里针对具体用户的补丁句。
 *
 * 历史数据里 system_prompt 直接写死了某位用户的昵称、真名与称呼权限；
 * 这些内容必须留在用户层，不能进入角色层，否则任何用户都会被当成同一个人。
 *
 * 只删除命中「只对某某有效 / 只有某某才可以叫 / 你与用户（…）是…关系」等
 * 用户专属指令的句子，其余人设文案保持字节级不变。
 *
 * 可通过 PERSONA_SCRUB=off 关闭（回滚方式：git revert 本次提交，并从数据库备份恢复 personas）。
 */
export function scrubPersonaRoleLayers(): { scanned: number; updated: number; redactedNames: number } {
  if ((process.env.PERSONA_SCRUB ?? "").toLowerCase() === "off") {
    return { scanned: 0, updated: 0, redactedNames: 0 };
  }
  let scanned = 0;
  let updated = 0;
  const redactedNames = new Set<string>();
  try {
    for (const persona of personaRepo.list()) {
      scanned += 1;
      const names = userIdentityRepo
        .listByPersona(persona.id)
        .flatMap((i) => [i.nickname, i.realName])
        .filter((n) => n && n.trim().length >= 2);
      for (const n of names) redactedNames.add(n);
      const cleaned = sanitizeRoleLayer(persona.systemPrompt ?? "", names);
      if (cleaned !== (persona.systemPrompt ?? "")) {
        personaRepo.update(persona.id, { name: persona.name, systemPrompt: cleaned });
        updated += 1;
        logger.warn(
          { personaId: persona.id, before: (persona.systemPrompt ?? "").length, after: cleaned.length },
          "removed user-specific clauses from persona role layer",
        );
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "persona role layer scrub failed, continue booting");
  }
  return { scanned, updated, redactedNames: redactedNames.size };
}
