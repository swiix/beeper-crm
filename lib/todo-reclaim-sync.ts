import { createLogger } from "@/lib/logger";
import {
  createReclaimTask,
  getReclaimConnectionStatus,
  todoToReclaimTaskInput,
  verifyReclaimConnection,
} from "@/lib/reclaim";
import { readTodoSettings } from "@/lib/todo-settings";
import { updateTodo, type TodoItem } from "@/lib/todo-db";

const log = createLogger("lib:todo-reclaim-sync");

export type SyncTodoToReclaimResult =
  | { ok: true; alreadySynced: boolean; reclaimTaskId: string; reclaimSyncAt: number | null }
  | { ok: false; error: string };

/**
 * Sync a CRM todo to Reclaim via HTTP API. Idempotent when already synced.
 */
export async function syncTodoToReclaim(
  todo: TodoItem,
  options?: { markAsNext?: boolean }
): Promise<SyncTodoToReclaimResult> {
  const localStatus = getReclaimConnectionStatus();
  if (!localStatus.connected) {
    return { ok: false, error: "Reclaim is not connected. Add an API token in Settings." };
  }

  const verified = await verifyReclaimConnection();
  if (!verified.connected) {
    return { ok: false, error: "Reclaim authentication failed. Check your API token in Settings." };
  }

  if (todo.external_reclaim_task_id) {
    return {
      ok: true,
      alreadySynced: true,
      reclaimTaskId: todo.external_reclaim_task_id,
      reclaimSyncAt: todo.reclaim_sync_at ?? null,
    };
  }

  try {
    const settings = readTodoSettings();
    const input = todoToReclaimTaskInput(todo, settings.todoListDefaultDurationHours, {
      markAsNext: options?.markAsNext,
    });
    const created = await createReclaimTask(input);
    const syncAt = Date.now();
    updateTodo(todo.id, {
      external_reclaim_task_id: String(created.id),
      reclaim_sync_at: syncAt,
    });

    return {
      ok: true,
      alreadySynced: false,
      reclaimTaskId: String(created.id),
      reclaimSyncAt: syncAt,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to sync todo to Reclaim.";
    log.warn({ err: e, todoId: todo.id }, "Todo Reclaim sync failed");
    return { ok: false, error: message };
  }
}
