import { randomUUID } from "node:crypto";

export function newId(prefix = ""): string {
  return prefix + randomUUID().replace(/-/g, "");
}

export function now(): number {
  return Date.now();
}

/** YYYY-MM-DD */
export function formatDate(date: Date | number = new Date()): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD HH:mm:ss */
export function formatDateTime(date: Date | number = new Date()): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function startOfDay(date: Date | number = new Date()): number {
  const d = typeof date === "number" ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(date: Date | number, days: number): Date {
  const d = typeof date === "number" ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function dateRangeLabel(days: number, endDate: Date = new Date()): string {
  const end = formatDate(endDate);
  const start = formatDate(addDays(endDate, -(days - 1)));
  return `${start} ~ ${end}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
