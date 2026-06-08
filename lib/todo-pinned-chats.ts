/**
 * Chats pinned to the top of Todo Chat (persisted in SQLite).
 */

import { getDb } from "@/lib/db";

export function listPinnedTodoChatIds(): string[] {
  const rows = getDb()
    .prepare("SELECT chat_id FROM todo_pinned_chats ORDER BY created_at ASC")
    .all() as { chat_id: string }[];
  return rows.map((r) => r.chat_id);
}

export function setPinnedTodoChatIds(chatIds: string[]): void {
  const db = getDb();
  const unique = [...new Set(chatIds.map((id) => id.trim()).filter(Boolean))];
  const tx = db.transaction((ids: string[]) => {
    db.prepare("DELETE FROM todo_pinned_chats").run();
    const insert = db.prepare("INSERT INTO todo_pinned_chats (chat_id, created_at) VALUES (?, ?)");
    const now = Date.now();
    for (const id of ids) insert.run(id, now);
  });
  tx(unique);
}

export function addPinnedTodoChatId(chatId: string): void {
  const id = chatId.trim();
  if (!id) return;
  getDb()
    .prepare("INSERT OR IGNORE INTO todo_pinned_chats (chat_id, created_at) VALUES (?, ?)")
    .run(id, Date.now());
}

export function removePinnedTodoChatId(chatId: string): void {
  getDb().prepare("DELETE FROM todo_pinned_chats WHERE chat_id = ?").run(chatId.trim());
}
