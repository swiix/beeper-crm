/**
 * Persistent storage for chat analyses and tinder priorities in SQLite.
 */

import type { ContactAnalysis } from "@/lib/types";
import { getDb } from "@/lib/db";

const VIEW_DEFAULT = "default";
const VIEW_TINDER = "tinder";
const MIN_PRIORITY = 1;
const MAX_PRIORITY = 10;

function clampPriority(n: number): number {
  return Math.min(MAX_PRIORITY, Math.max(MIN_PRIORITY, Math.round(n)));
}

function viewFromTinder(isTinder: boolean): string {
  return isTinder ? VIEW_TINDER : VIEW_DEFAULT;
}

function rowToAnalysis(row: {
  summary: string | null;
  branche: string | null;
  kaufkraft: string | null;
  wunsch: string | null;
  pain: string | null;
  stage: string | null;
  next_message_suggestions: string | null;
  priority_index: number | null;
}): ContactAnalysis {
  let nextMessageSuggestions: string[] | undefined;
  if (row.next_message_suggestions) {
    try {
      const parsed = JSON.parse(row.next_message_suggestions) as unknown;
      if (Array.isArray(parsed)) {
        nextMessageSuggestions = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // ignore
    }
  }
  return {
    summary: row.summary ?? undefined,
    branche: row.branche ?? undefined,
    kaufkraft: row.kaufkraft ?? undefined,
    wunsch: row.wunsch ?? undefined,
    pain: row.pain ?? undefined,
    stage: row.stage ?? undefined,
    nextMessageSuggestions,
    priorityIndex: row.priority_index != null ? row.priority_index : undefined,
  };
}

export interface AnalysisCacheMeta {
  lastMessageSortKey: string | null;
  analysisPromptHash: string | null;
}

/**
 * Save or replace analysis for a chat and view. Persists across restarts.
 * Pass cacheMeta after OpenAI runs so smart cache survives server restarts.
 */
export function saveAnalysis(
  chatId: string,
  isTinder: boolean,
  data: ContactAnalysis,
  cacheMeta?: AnalysisCacheMeta
): void {
  if (!chatId) return;
  const view = viewFromTinder(isTinder);
  const db = getDb();
  const now = Date.now();
  const priorityIndex =
    data.priorityIndex != null ? clampPriority(data.priorityIndex) : null;
  const nextMessageSuggestions = Array.isArray(data.nextMessageSuggestions)
    ? JSON.stringify(data.nextMessageSuggestions)
    : null;
  const lastSk = cacheMeta?.lastMessageSortKey ?? null;
  const promptHash = cacheMeta?.analysisPromptHash ?? null;
  const stmt = db.prepare(`
    INSERT INTO chat_analyses (chat_id, view, summary, branche, kaufkraft, wunsch, pain, stage, next_message_suggestions, priority_index, updated_at, last_message_sort_key, analysis_prompt_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (chat_id, view) DO UPDATE SET
      summary = excluded.summary,
      branche = excluded.branche,
      kaufkraft = excluded.kaufkraft,
      wunsch = excluded.wunsch,
      pain = excluded.pain,
      stage = excluded.stage,
      next_message_suggestions = excluded.next_message_suggestions,
      priority_index = excluded.priority_index,
      updated_at = excluded.updated_at,
      last_message_sort_key = excluded.last_message_sort_key,
      analysis_prompt_hash = excluded.analysis_prompt_hash
  `);
  stmt.run(
    chatId,
    view,
    data.summary ?? null,
    data.branche ?? null,
    data.kaufkraft ?? null,
    data.wunsch ?? null,
    data.pain ?? null,
    data.stage ?? null,
    nextMessageSuggestions,
    priorityIndex,
    now,
    lastSk,
    promptHash
  );
}

/**
 * Load analysis for a chat and view from the database. Returns null if not found.
 */
export function getAnalysis(chatId: string, isTinder: boolean): ContactAnalysis | null {
  if (!chatId) return null;
  const view = viewFromTinder(isTinder);
  const db = getDb();
  const row = db
    .prepare(
      "SELECT summary, branche, kaufkraft, wunsch, pain, stage, next_message_suggestions, priority_index FROM chat_analyses WHERE chat_id = ? AND view = ?"
    )
    .get(chatId, view) as {
      summary: string | null;
      branche: string | null;
      kaufkraft: string | null;
      wunsch: string | null;
      pain: string | null;
      stage: string | null;
      next_message_suggestions: string | null;
      priority_index: number | null;
    } | undefined;
  if (!row) return null;
  return rowToAnalysis(row);
}

/**
 * Load analysis plus persisted smart-cache fields (marker + prompt hash).
 */
export function getAnalysisCacheRow(
  chatId: string,
  isTinder: boolean
): { analysis: ContactAnalysis; lastMessageSortKey: string | null; analysisPromptHash: string | null } | null {
  if (!chatId) return null;
  const view = viewFromTinder(isTinder);
  const db = getDb();
  const row = db
    .prepare(
      "SELECT summary, branche, kaufkraft, wunsch, pain, stage, next_message_suggestions, priority_index, last_message_sort_key, analysis_prompt_hash FROM chat_analyses WHERE chat_id = ? AND view = ?"
    )
    .get(chatId, view) as
    | {
        summary: string | null;
        branche: string | null;
        kaufkraft: string | null;
        wunsch: string | null;
        pain: string | null;
        stage: string | null;
        next_message_suggestions: string | null;
        priority_index: number | null;
        last_message_sort_key: string | null;
        analysis_prompt_hash: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    analysis: rowToAnalysis(row),
    lastMessageSortKey: row.last_message_sort_key ?? null,
    analysisPromptHash: row.analysis_prompt_hash ?? null,
  };
}

/**
 * Get stored priorityIndex for tinder view for the given chat IDs.
 */
export function getTinderPriorities(chatIds: string[]): Record<string, number> {
  if (chatIds.length === 0) return {};
  const db = getDb();
  const placeholders = chatIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT chat_id, priority_index FROM chat_analyses WHERE view = ? AND chat_id IN (${placeholders}) AND priority_index IS NOT NULL`
    )
    .all(VIEW_TINDER, ...chatIds) as Array<{ chat_id: string; priority_index: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const n = clampPriority(r.priority_index);
    out[r.chat_id] = n;
  }
  return out;
}

/**
 * Set or update only priorityIndex for tinder view. Creates a row if none exists.
 */
export function setTinderPriority(chatId: string, priorityIndex: number): void {
  if (!chatId) return;
  const n = clampPriority(priorityIndex);
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO chat_analyses (chat_id, view, priority_index, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (chat_id, view) DO UPDATE SET priority_index = excluded.priority_index, updated_at = excluded.updated_at`
  ).run(chatId, VIEW_TINDER, n, now);
}

/** Remove all persisted chat analyses (CRM + Tinder smart cache). */
export function clearAllAnalyses(): void {
  getDb().prepare("DELETE FROM chat_analyses").run();
}
