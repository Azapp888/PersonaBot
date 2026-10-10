import { formatDateTime } from "./id";

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

function build(ts: number): ClockSnapshot {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = formatDateTime(ts);
  return {
    now: ts,
    iso: d.toISOString(),
    formatted: `${base} ${WEEKDAYS[d.getDay()]}`,
    date: base.slice(0, 10),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    weekday: WEEKDAYS[d.getDay()],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffsetMinutes: -d.getTimezoneOffset(),
  };
}

/**
 * 统一系统时钟。
 *
 * 每次调用都实时读取宿主机时间，不做任何缓存，确保每次请求（含网关消息）
 * 处理时拿到的都是「当前真实时间」，而不是进程启动时间或上一次的时间。
 */
export const systemClock = {
  now(): number {
    return Date.now();
  },
  snapshot(): ClockSnapshot {
    return build(Date.now());
  },
  format(ts: number = Date.now()): string {
    return build(ts).formatted;
  },
};
