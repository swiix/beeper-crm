import {
  DEFAULT_TODO_DEFAULT_DURATION_HOURS,
  readTodoSettings,
} from "@/lib/todo-settings";

/** Effective duration in minutes when todo has no positive estimate. */
export function resolveEstimatedTimeMinutes(
  minutes: number | null | undefined,
  defaultHours?: number
): number {
  if (minutes != null && Number.isFinite(minutes) && minutes > 0) {
    return Math.round(minutes);
  }
  const hours =
    defaultHours != null && Number.isFinite(defaultHours) && defaultHours > 0
      ? defaultHours
      : readTodoSettings().todoListDefaultDurationHours;
  const safeHours =
    Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TODO_DEFAULT_DURATION_HOURS;
  return Math.max(1, Math.round(safeHours * 60));
}

export function hoursToEstimatedMinutes(hours: number): number {
  return Math.max(1, Math.round(hours * 60));
}
