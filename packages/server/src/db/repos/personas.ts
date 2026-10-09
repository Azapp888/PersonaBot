import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { Persona, PaintingConfig, ModelConfig, Personality, PersonaCommand } from "../../types";
import { newId, now } from "../../utils/id";
import { safeJsonParse, toJson } from "../../utils/json";

const defaultPainting: PaintingConfig = {
  enabled: false,
  style: "",
  artistReference: "",
  characterDna: "",
  provider: "",
  model: "",
};

const defaultModelConfig: ModelConfig = {
  temperature: 0.8,
  maxTokens: 2048,
};

const defaultPersonality: Personality = {
  traits: [],
  speakingStyle: "",
  catchphrases: [],
  emotionalTendency: "",
  canPaint: false,
};

function map(row: any): Persona {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    description: row.description,
    systemPrompt: row.system_prompt,
    personality: safeJsonParse<Personality>(row.personality, defaultPersonality),
    skills: safeJsonParse<string[]>(row.skills, []),
    commands: safeJsonParse<PersonaCommand[]>(row.commands, []),
    paintingConfig: { ...defaultPainting, ...safeJsonParse<Partial<PaintingConfig>>(row.painting_config, {}) },
    modelConfig: { ...defaultModelConfig, ...safeJsonParse<Partial<ModelConfig>>(row.model_config, {}) },
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PersonaInput {
  name: string;
  avatar?: string | null;
  description?: string;
  systemPrompt?: string;
  personality?: Partial<Personality>;
  skills?: string[];
  commands?: PersonaCommand[];
  paintingConfig?: Partial<PaintingConfig>;
  modelConfig?: Partial<ModelConfig>;
  enabled?: boolean;
}

export const personaRepo = {
  db(): Database.Database {
    return getDb();
  },
  list(): Persona[] {
    return this.db().prepare(`SELECT * FROM personas ORDER BY created_at DESC`).all().map(map);
  },
  listEnabled(): Persona[] {
    return this.db().prepare(`SELECT * FROM personas WHERE enabled = 1`).all().map(map);
  },
  find(id: string): Persona | null {
    const row = this.db().prepare(`SELECT * FROM personas WHERE id = ?`).get(id);
    return row ? map(row) : null;
  },
  create(input: PersonaInput): Persona {
    const id = newId("per_");
    const ts = now();
    this.db()
      .prepare(
        `INSERT INTO personas (id, name, avatar, description, system_prompt, personality, skills, commands, painting_config, model_config, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.avatar ?? null,
        input.description ?? "",
        input.systemPrompt ?? "",
        toJson({ ...defaultPersonality, ...(input.personality ?? {}) }),
        toJson(input.skills ?? []),
        toJson(input.commands ?? []),
        toJson({ ...defaultPainting, ...(input.paintingConfig ?? {}) }),
        toJson({ ...defaultModelConfig, ...(input.modelConfig ?? {}) }),
        input.enabled === false ? 0 : 1,
        ts,
        ts,
      );
    return this.find(id)!;
  },
  update(id: string, input: PersonaInput): Persona | null {
    const current = this.find(id);
    if (!current) return null;
    const merged = {
      name: input.name ?? current.name,
      avatar: input.avatar !== undefined ? input.avatar : current.avatar,
      description: input.description ?? current.description,
      systemPrompt: input.systemPrompt ?? current.systemPrompt,
      personality: { ...current.personality, ...(input.personality ?? {}) },
      skills: input.skills ?? current.skills,
      commands: input.commands ?? current.commands,
      paintingConfig: { ...current.paintingConfig, ...(input.paintingConfig ?? {}) },
      modelConfig: { ...current.modelConfig, ...(input.modelConfig ?? {}) },
      enabled: input.enabled !== undefined ? input.enabled : current.enabled,
    };
    this.db()
      .prepare(
        `UPDATE personas SET name = ?, avatar = ?, description = ?, system_prompt = ?, personality = ?, skills = ?, commands = ?, painting_config = ?, model_config = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.avatar,
        merged.description,
        merged.systemPrompt,
        toJson(merged.personality),
        toJson(merged.skills),
        toJson(merged.commands),
        toJson(merged.paintingConfig),
        toJson(merged.modelConfig),
        merged.enabled ? 1 : 0,
        now(),
        id,
      );
    return this.find(id);
  },
  remove(id: string): void {
    const db = this.db();
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM personas WHERE id = ?`).run(id);
      db.prepare(`DELETE FROM memories WHERE persona_id = ?`).run(id);
      db.prepare(`DELETE FROM conversations WHERE persona_id = ?`).run(id);
      db.prepare(`DELETE FROM user_profiles WHERE persona_id = ?`).run(id);
      db.prepare(`UPDATE bots SET persona_id = NULL WHERE persona_id = ?`).run(id);
    });
    tx();
  },
};
