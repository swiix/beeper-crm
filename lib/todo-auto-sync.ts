import { createLogger } from "@/lib/logger";
import { getGoogleTasksConnectionStatus } from "@/lib/google-tasks";
import { getReclaimConnectionStatus } from "@/lib/reclaim";
import { readTodoSettings, type TodoSyncTarget } from "@/lib/todo-settings";
import { syncTodoToGoogleTasks } from "@/lib/todo-google-sync";
import { syncTodoToReclaim } from "@/lib/todo-reclaim-sync";
import type { TodoItem } from "@/lib/todo-db";

const log = createLogger("lib:todo-auto-sync");

export type AutoSyncTodoResult = { ok: boolean; error?: string };

export function getConfiguredTodoSyncTarget(): TodoSyncTarget {
  return readTodoSettings().todoSyncTarget;
}

export function assertTodoSyncTarget(expected: TodoSyncTarget): string | null {
  const target = getConfiguredTodoSyncTarget();
  if (target === expected) return null;
  const configured = target === "google" ? "Google Tasks" : "Reclaim";
  return `Sync-Ziel ist ${configured}. Bitte unter Einstellungen → Todo anpassen.`;
}

/**
 * Auto-sync a newly accepted todo to the single configured target (Google or Reclaim).
 */
export async function maybeAutoSyncTodoOnAccept(todo: TodoItem): Promise<(AutoSyncTodoResult & { target: TodoSyncTarget }) | null> {
  const settings = readTodoSettings();
  if (!settings.autoSyncOnAccept) return null;

  if (settings.todoSyncTarget === "google") {
    if (!getGoogleTasksConnectionStatus().connected) return null;
    const result = await syncTodoToGoogleTasks(todo);
    if (result.ok) return { target: "google", ok: true };
    log.warn({ todoId: todo.id, error: result.error }, "Auto Google Tasks sync failed after todo create");
    return { target: "google", ok: false, error: result.error };
  }

  if (!getReclaimConnectionStatus().connected) return null;
  const result = await syncTodoToReclaim(todo);
  if (result.ok) return { target: "reclaim", ok: true };
  log.warn({ todoId: todo.id, error: result.error }, "Auto Reclaim sync failed after todo create");
  return { target: "reclaim", ok: false, error: result.error };
}
