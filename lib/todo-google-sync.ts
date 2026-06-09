import { createLogger } from "@/lib/logger";
import { updateTodo, type TodoItem } from "@/lib/todo-db";
import { appendGoogleTaskCreateLog } from "@/lib/google-tasks-create-log";
import { buildReclaimTaskTitle, todoItemToReclaimSyntaxInput } from "@/lib/reclaim-task-syntax";
import { resolveEstimatedTimeMinutes } from "@/lib/todo-duration";
import { getGoogleTasksConnectionStatus, insertGoogleTask } from "@/lib/google-tasks";

const log = createLogger("lib:todo-google-sync");

export type SyncTodoToGoogleTasksResult =
  | { ok: true; alreadySynced: boolean; googleTaskId: string; googleTaskLink?: string | null; googleSyncAt: number | null }
  | { ok: false; error: string };

/**
 * Sync a CRM todo to Google Tasks. Idempotent when already synced.
 */
export async function syncTodoToGoogleTasks(todo: TodoItem): Promise<SyncTodoToGoogleTasksResult> {
  const status = getGoogleTasksConnectionStatus();
  if (!status.connected) {
    return { ok: false, error: "Google Tasks is not connected. Please connect first." };
  }

  if (todo.external_google_task_id) {
    return {
      ok: true,
      alreadySynced: true,
      googleTaskId: todo.external_google_task_id,
      googleSyncAt: todo.google_sync_at ?? null,
    };
  }

  try {
    const effectiveMinutes = resolveEstimatedTimeMinutes(todo.estimated_time_minutes);
    const reclaimTitle = buildReclaimTaskTitle(
      todoItemToReclaimSyntaxInput(todo, effectiveMinutes)
    );

    const inserted = await insertGoogleTask({
      title: reclaimTitle,
      notes: todo.notes,
      due_date: todo.due_date,
      due_at: todo.due_at ?? null,
    });

    const syncAt = Date.now();
    updateTodo(todo.id, {
      external_google_task_id: inserted.id,
      google_sync_at: syncAt,
    });

    appendGoogleTaskCreateLog({
      todoId: todo.id,
      crmTitleRaw: todo.title,
      sentTitleExact: reclaimTitle,
      dueDateYmd: todo.due_date,
      priority: todo.priority,
      estimatedTimeMinutes: effectiveMinutes,
      googleTaskId: inserted.id,
      googleWebViewLink: inserted.webViewLink ?? null,
    });

    return {
      ok: true,
      alreadySynced: false,
      googleTaskId: inserted.id,
      googleTaskLink: inserted.webViewLink,
      googleSyncAt: syncAt,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to sync todo to Google Tasks.";
    log.warn({ err: e, todoId: todo.id }, "Todo Google sync failed");
    return { ok: false, error: message };
  }
}
