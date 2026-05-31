import { createLogger } from "@/lib/logger";
import { patchGoogleTask } from "@/lib/google-tasks";
import { patchReclaimTask } from "@/lib/reclaim";
import { buildReclaimTaskTitle } from "@/lib/reclaim-task-syntax";
import { getConfiguredTodoSyncTarget } from "@/lib/todo-auto-sync";
import { resolveEstimatedTimeMinutes } from "@/lib/todo-duration";
import { readTodoSettings } from "@/lib/todo-settings";
import { todoToReclaimTaskInput } from "@/lib/reclaim";
import type { TodoItem } from "@/lib/todo-db";

const log = createLogger("lib:todo-external-push");

export type PushTodoToExternalResult = { ok: true } | { ok: false; error: string };

/**
 * Push CRM todo changes to the already-linked external task (Google or Reclaim).
 */
export async function pushTodoChangesToExternal(todo: TodoItem): Promise<PushTodoToExternalResult | null> {
  const target = getConfiguredTodoSyncTarget();
  const settings = readTodoSettings();

  if (target === "google") {
    if (!todo.external_google_task_id) return null;
    try {
      const minutes = resolveEstimatedTimeMinutes(todo.estimated_time_minutes, settings.todoListDefaultDurationHours);
      const title = buildReclaimTaskTitle({
        title: todo.title,
        due_date: todo.due_date,
        priority: todo.priority,
        estimated_time_minutes: minutes,
      });
      await patchGoogleTask(todo.external_google_task_id, {
        title,
        notes: todo.notes,
        due_date: todo.due_date,
        due_at: todo.due_at,
      });
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to update Google Task.";
      log.warn({ err: e, todoId: todo.id }, "Todo Google push failed");
      return { ok: false, error: message };
    }
  }

  if (!todo.external_reclaim_task_id) return null;
  const reclaimId = parseInt(todo.external_reclaim_task_id, 10);
  if (!Number.isFinite(reclaimId)) return null;
  try {
    const input = todoToReclaimTaskInput(todo, settings.todoListDefaultDurationHours);
    await patchReclaimTask(reclaimId, input);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update Reclaim task.";
    log.warn({ err: e, todoId: todo.id }, "Todo Reclaim push failed");
    return { ok: false, error: message };
  }
}
