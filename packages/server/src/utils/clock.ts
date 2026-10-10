const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export interface ClockSnapshot {
  now: number;
  iso: string;
  formatted: string;
  date: string;
  time: string;
  weekday: string;
  timezone: string;
  utcOffsetMinutes: number;
}

const DATE_TIME_FMT = (timeZone?: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const WEEKDAY_FMT = (timeZone?: string) => new Intl.DateTimeFormat("zh-CN", { timeZone, weekday: "short" });

function pick(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/**
 * 归一化时区：特殊值 "server"/"system"/空 表示跟随服务器操作系统时区；
 * 其余按 IANA 时区名处理（如 Asia/Shanghai 表示北京时间）。
 */
function normalizeTz(timeZone?: string): string | undefined {
  if (!timeZone) return undefined;
  const t = timeZone.trim();
  if (!t || t === "server" || t === "system" || t === "local") return undefined;
  return t;
}

function offsetMinutes(ts: number, timeZone?: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: normalizeTz(timeZone), timeZoneName: "longOffset" });
    const name = dtf.formatToParts(new Date(ts)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return 0;
  }
}

/** 在指定 IANA 时区格式化时间；时区无效时回退到服务器本地时区。 */
function zoned(ts: number, timeZone?: string): { formatted: string; date: string; time: string; weekday: string; resolvedTz: string } {
  const d = new Date(ts);
  let tz = normalizeTz(timeZone);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = DATE_TIME_FMT(tz).formatToParts(d);
  } catch {
    tz = undefined;
    parts = DATE_TIME_FMT(undefined).formatToParts(d);
  }
  const yyyy = pick(parts, "year");
  const mm = pick(parts, "month");
  const dd = pick(parts, "day");
  const hh = pick(parts, "hour");
  const mi = pick(parts, "minute");
  const ss = pick(parts, "second");
  const weekday = WEEKDAY_FMT(tz).format(d);
  const date = `${yyyy}-${mm}-${dd}`;
  const time = `${hh}:${mi}:${ss}`;
  return {
    formatted: `${date} ${time} ${weekday}`,
    date,
    time,
    weekday,
    resolvedTz: tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function build(ts: number, timeZone?: string): ClockSnapshot {
  const z = zoned(ts, timeZone);
  return {
    now: ts,
    iso: new Date(ts).toISOString(),
    formatted: z.formatted,
    date: z.date,
    time: z.time,
    weekday: z.weekday,
    timezone: z.resolvedTz,
    utcOffsetMinutes: offsetMinutes(ts, timeZone),
  };
}

/**
 * 统一系统时钟。
 *
 * 每次调用都实时读取宿主机时间，不做任何缓存，确保每次请求（含网关消息）
 * 处理时拿到的都是「当前真实时间」，而不是进程启动时间或上一次的时间。
 * 支持按 IANA 时区格式化，避免在 UTC 容器中把时间注入成 UTC。
 */
export const systemClock = {
  now(): number {
    return Date.now();
  },
  snapshot(timeZone?: string): ClockSnapshot {
    return build(Date.now(), timeZone);
  },
  format(ts: number = Date.now(), timeZone?: string): string {
    return zoned(ts, timeZone).formatted;
  },
};
