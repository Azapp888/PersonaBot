import { modelRepo } from "../db/repos/models";
import { createProviderFromModel } from "./factory";
import { detectModelVision, providerOf, visionSpecFor, type ModelForVision } from "./vision";
import { logger } from "../logger";

export interface VisionScanItem {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  previous: boolean;
  detected: boolean | null;
  changed: boolean;
  source: "probe" | "heuristic";
  reason?: string;
  error?: string;
}

export interface VisionScanSummary {
  total: number;
  probed: number;
  updated: number;
  unknown: number;
  items: VisionScanItem[];
}

export interface VisionScanOptions {
  /** 仅扫描这些模型 id；缺省扫描全部启用模型。 */
  onlyEnabled?: boolean;
  /** 是否写回数据库（默认 true）。 */
  persist?: boolean;
  /** 是否对命名无法判断的模型做真实网络探测（默认 true）。 */
  probe?: boolean;
  /** 探测并发上限，默认 3，避免触发上游限流。 */
  concurrency?: number;
}

/**
 * 扫描所有模型的读图能力，并（默认）将结果写回 models.supports_vision。
 *
 * 上线/部署后自动运行，确保每个提供商下的模型是否支持读图始终是"实测过的事实"，
 * 而不是靠人工在后台逐个勾选。命名能确定的模型不消耗网络请求；无法确定的才实测。
 */
export async function scanModelsVision(options: VisionScanOptions = {}): Promise<VisionScanSummary> {
  const { onlyEnabled = true, persist = true, probe = true, concurrency = 3 } = options;
  const models = onlyEnabled ? modelRepo.listEnabled() : modelRepo.list();
  const items: VisionScanItem[] = [];

  let cursor = 0;
  const worker = async () => {
    while (cursor < models.length) {
      const model = models[cursor++];
      items.push(await scanOne(model, { persist, probe }));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, models.length)) }, worker));

  const summary: VisionScanSummary = {
    total: items.length,
    probed: items.filter((i) => i.source === "probe").length,
    updated: items.filter((i) => i.changed).length,
    unknown: items.filter((i) => i.detected === null).length,
    items: items.sort((a, b) => a.id.localeCompare(b.id)),
  };
  logger.info(
    { total: summary.total, probed: summary.probed, updated: summary.updated, unknown: summary.unknown },
    "vision scan finished",
  );
  return summary;
}

async function scanOne(
  model: ModelForVision,
  { persist, probe }: { persist: boolean; probe: boolean },
): Promise<VisionScanItem> {
  const providerName = providerOf(model.provider);
  const spec = visionSpecFor(providerName);
  const base: VisionScanItem = {
    id: model.id,
    name: (model as any).name ?? model.modelId,
    provider: providerName,
    modelId: model.modelId,
    previous: !!model.supportsVision,
    detected: null,
    changed: false,
    source: "heuristic",
  };

  // 明确不支持视觉的提供商不必探测
  if (!spec.supportsVision) {
    base.detected = false;
    base.source = "heuristic";
    base.reason = spec.note;
    base.changed = persist && base.previous !== false;
    if (base.changed) modelRepo.update(model.id, { supportsVision: false });
    return base;
  }

  try {
    const provider = createProviderFromModel(model as any);
    const result = probe
      ? await detectModelVision(provider, providerName, model.modelId)
      : { supported: null as boolean | null, source: "heuristic" as const, reason: "已关闭实测" };
    base.detected = result.supported;
    base.source = result.source;
    if (result.reason) base.reason = result.reason;
    if (persist && result.supported !== null && model.supportsVision !== result.supported) {
      modelRepo.update(model.id, { supportsVision: result.supported });
      base.changed = true;
    }
  } catch (err) {
    base.error = (err as Error).message;
    logger.warn({ modelId: model.modelId, err: base.error }, "vision scan failed for model");
  }
  return base;
}
