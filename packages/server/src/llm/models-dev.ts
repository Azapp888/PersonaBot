import { fetchWithTimeout } from "../utils/http";
import { logger } from "../logger";

/**
 * models.dev 模型元数据（读图能力的第一手依据）。
 *
 * 为什么用它：models.dev 是开源社区维护的模型能力目录，每个模型带有
 * `attachment`（能否接收附件，即读图）与 `modalities.input`（输入模态列表），
 * 这正是 `@realseek/opencode-models-discovery` 等工具用来判定「是否多模态」的权威字段。
 *
 * 该目录仅作为「命名能确定能力」时的权威依据，无法命中时仍回退到真实探测。
 */

const CATALOG_URL = process.env.MODELS_DEV_URL || "https://models.dev/api.json";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

export interface CatalogModelMeta {
  id: string;
  name?: string;
  /** 能否接收附件（图片/PDF），即读图能力。 */
  attachment: boolean;
  /** 输入模态，如 ["text","image","pdf"]。 */
  inputModalities: string[];
}

interface CatalogState {
  loadedAt: number;
  /** 归一化模型名 -> 元数据；同名多提供商时以「支持读图」为准合并。 */
  byModel: Map<string, CatalogModelMeta>;
  /** 兜底：按 host/vendor 归纳的可用模型名集合，用于子串匹配。 */
  size: number;
}

let state: CatalogState | null = null;
let inflight: Promise<CatalogState | null> | null = null;

/** 归一化模型名：去掉提供商前缀（如 openai/gpt-4o -> gpt-4o）、版本分隔符标准化。 */
function normalizeModelId(id: string): string {
  let s = (id || "").trim().toLowerCase();
  const slash = s.lastIndexOf("/");
  if (slash !== -1) s = s.slice(slash + 1);
  const colon = s.lastIndexOf(":");
  if (colon !== -1) s = s.slice(0, colon);
  return s;
}

function indexCatalog(raw: any): CatalogState {
  const byModel = new Map<string, CatalogModelMeta>();
  if (raw && typeof raw === "object") {
    for (const provider of Object.values<any>(raw)) {
      const models = provider?.models;
      if (!models || typeof models !== "object") continue;
      for (const m of Object.values<any>(models)) {
        const id = String(m?.id ?? "").trim();
        if (!id) continue;
        const inputModalities: string[] = Array.isArray(m?.modalities?.input)
          ? m.modalities.input.map((x: any) => String(x).toLowerCase())
          : [];
        const attachment =
          m?.attachment === true || inputModalities.includes("image");
        const key = normalizeModelId(id);
        if (!key) continue;
        const prev = byModel.get(key);
        // 同名多处出现时，只要有一处支持读图即视为支持
        if (!prev || (!prev.attachment && attachment)) {
          byModel.set(key, {
            id,
            name: typeof m?.name === "string" ? m.name : undefined,
            attachment,
            inputModalities,
          });
        }
      }
    }
  }
  return { loadedAt: Date.now(), byModel, size: byModel.size };
}

/** 加载目录（带内存缓存与并发去重）。失败返回 null，交由调用方回退探测。 */
export async function loadCatalog(force = false): Promise<CatalogState | null> {
  if (!force && state && Date.now() - state.loadedAt < CACHE_TTL_MS) return state;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetchWithTimeout(CATALOG_URL, { timeoutMs: 20000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      state = indexCatalog(raw);
      logger.info({ models: state.size, source: CATALOG_URL }, "models.dev catalog loaded");
      return state;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "models.dev catalog unavailable, fall back to probe");
      return state;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export interface MetadataVisionLookup {
  supported: boolean;
  matched: string;
  /** 命中方式：精确 id 命中，或去掉版本后缀的前缀命中。 */
  via: "exact" | "prefix";
}

/**
 * 依据 models.dev 元数据判定模型是否支持读图。
 * 返回 null 表示目录里没有这个模型（无法据此判断）。
 */
export function lookupVisionFromMetadata(modelId: string): MetadataVisionLookup | null {
  if (!state) return null;
  const key = normalizeModelId(modelId);
  if (!key) return null;
  const exact = state.byModel.get(key);
  if (exact) return { supported: exact.attachment, matched: exact.id, via: "exact" };

  // 前缀命中：处理带日期/编号后缀的版本（如 gpt-4o-2024-08-06 -> gpt-4o）
  let best: CatalogModelMeta | null = null;
  let bestLen = 0;
  for (const [k, v] of state.byModel) {
    if (k.length < 4) continue;
    if (key === k || key.startsWith(`${k}-`) || key.startsWith(`${k}.`)) {
      if (k.length > bestLen) {
        best = v;
        bestLen = k.length;
      }
    }
  }
  if (best) return { supported: best.attachment, matched: best.id, via: "prefix" };
  return null;
}

export function catalogReady(): boolean {
  return !!state;
}

export function catalogModelCount(): number {
  return state?.size ?? 0;
}
