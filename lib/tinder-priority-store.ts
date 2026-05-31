/**
 * Tinder chat priority persistence. Uses SQLite (analysis-db) for storage.
 */

import { getTinderPriorities, setTinderPriority } from "@/lib/analysis-db";

/**
 * Returns stored priorityIndex for the given chat IDs. Only includes entries that exist.
 */
export function getPriorities(chatIds: string[]): Record<string, number> {
  return getTinderPriorities(chatIds);
}

/**
 * Writes priorityIndex (1–10) for one chat.
 */
export function setPriority(chatId: string, priorityIndex: number): void {
  setTinderPriority(chatId, priorityIndex);
}
