import type Database from "better-sqlite3";
import { getDb } from "../index";

export const settingRepo = {
  db(): Database.Database {
    return getDb();
  },
  all(): Record<string, string> {
    const rows = this.db().prepare(`SELECT key, value FROM settings`).all() as any[];
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  },
  get(key: string): string | null {
    const row = this.db().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
    return row ? (row.value as string) : null;
  },
  set(key: string, value: string): void {
    this.db()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  },
  setMany(values: Record<string, string>): void {
    const stmt = this.db().prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    const tx = this.db().transaction((entries: [string, string][]) => {
      for (const [k, v] of entries) stmt.run(k, v);
    });
    tx(Object.entries(values));
  },
};
