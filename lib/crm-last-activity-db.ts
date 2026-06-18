/**
 * CRM last-activity cache in SQLite (beeper-crm.db).
 * Survives server restarts; in-memory cache remains a fast L1 layer.
 */

import { getDb } from "@/lib/db";

export type CrmLastActivity = {
  lastFromMe: string | null;
  lastFromThem: string | null;
  followUpCount: number;
};

export function getCrmLastActivityFromDb(chatId: string, maxAgeMs: number): CrmLastActivity | null {
  if (!chatId.trim()) return null;
  const db = getDb();
  const row = db
    .prepare(
      "SELECT last_from_me, last_from_them, follow_up_count, updated_at FROM crm_last_activity WHERE chat_id = ?"
    )
    .get(chatId) as
    | {
        last_from_me: string | null;
        last_from_them: string | null;
        follow_up_count: number;
        updated_at: number;
      }
    | undefined;
  if (!row) return null;
  if (maxAgeMs > 0 && Date.now() - row.updated_at > maxAgeMs) return null;
  return {
    lastFromMe: row.last_from_me ?? null,
    lastFromThem: row.last_from_them ?? null,
    followUpCount: row.follow_up_count ?? 0,
  };
}

export function setCrmLastActivityInDb(chatId: string, activity: CrmLastActivity): void {
  if (!chatId.trim()) return;
  const db = getDb();
  db.prepare(
    `INSERT INTO crm_last_activity (chat_id, last_from_me, last_from_them, follow_up_count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET
       last_from_me = excluded.last_from_me,
       last_from_them = excluded.last_from_them,
       follow_up_count = excluded.follow_up_count,
       updated_at = excluded.updated_at`
  ).run(
    chatId,
    activity.lastFromMe,
    activity.lastFromThem,
    activity.followUpCount,
    Date.now()
  );
}

export function deleteCrmLastActivityFromDb(chatId: string): void {
  if (!chatId.trim()) return;
  getDb().prepare("DELETE FROM crm_last_activity WHERE chat_id = ?").run(chatId);
}

export function clearAllCrmLastActivityInDb(): void {
  getDb().prepare("DELETE FROM crm_last_activity").run();
}
