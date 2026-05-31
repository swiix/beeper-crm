import { localCalendarTodayYmd } from "@/lib/date-local";

/** Default time when only a date shortcut is chosen */
export const DEFAULT_DUE_TIME = "20:00";

export type DueDateTime = {
  date: string | null;
  time: string | null;
};

export function emptyDueDateTime(): DueDateTime {
  return { date: null, time: null };
}

export function isValidYmd(s: string | null | undefined): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isValidHm(s: string | null | undefined): s is string {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}

export function syncDueDateFromDateTime(dt: DueDateTime): string | null {
  return isValidYmd(dt.date) ? dt.date : null;
}

export function dueDateTimeToMs(dt: DueDateTime): number | null {
  if (!isValidYmd(dt.date)) return null;
  const hm = isValidHm(dt.time) ? dt.time : DEFAULT_DUE_TIME;
  const [h, min] = hm.split(":").map((x) => parseInt(x, 10));
  const parts = dt.date.split("-").map((x) => parseInt(x, 10));
  const d = new Date(parts[0], parts[1] - 1, parts[2], h, min, 0, 0);
  return d.getTime();
}

export function msToDueDateTime(ms: number | null | undefined): DueDateTime {
  if (ms == null || !Number.isFinite(ms)) return emptyDueDateTime();
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return emptyDueDateTime();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, time: `${h}:${min}` };
}

export function dueAtToGoogleRfc3339(dueAt: number): string {
  return new Date(dueAt).toISOString();
}

export function todoDueToDateTime(todo: {
  due_at?: number | null;
  due_date?: string | null;
}): DueDateTime {
  if (todo.due_at != null && Number.isFinite(todo.due_at)) {
    return msToDueDateTime(todo.due_at);
  }
  if (isValidYmd(todo.due_date)) {
    return { date: todo.due_date, time: DEFAULT_DUE_TIME };
  }
  return emptyDueDateTime();
}

export function suggestionDueToDateTime(due: string | null, dueTime?: string | null): DueDateTime {
  if (!isValidYmd(due)) return emptyDueDateTime();
  return { date: due, time: isValidHm(dueTime) ? dueTime : DEFAULT_DUE_TIME };
}

export function parseDueFieldsFromBody(body: Record<string, unknown>): {
  due_date: string | null;
  due_at: number | null;
} {
  if (body.due_at === null || body.due_date === null) {
    return { due_date: null, due_at: null };
  }
  if (typeof body.due_at === "number" && Number.isFinite(body.due_at)) {
    const dt = msToDueDateTime(body.due_at);
    return { due_date: syncDueDateFromDateTime(dt), due_at: body.due_at };
  }
  const date =
    typeof body.due_date === "string" && isValidYmd(body.due_date) ? body.due_date : null;
  const time =
    typeof body.due_time === "string" && isValidHm(body.due_time) ? body.due_time : DEFAULT_DUE_TIME;
  if (!date) return { due_date: null, due_at: null };
  const ms = dueDateTimeToMs({ date, time });
  return { due_date: date, due_at: ms };
}

export function formatDueDateTimeRelative(dt: DueDateTime): string {
  if (!isValidYmd(dt.date)) return "";
  const date = new Date(dt.date + "T12:00:00");
  if (Number.isNaN(date.getTime())) return "";
  const todayStr = localCalendarTodayYmd();
  const todayDate = new Date(todayStr + "T12:00:00");
  const diffMs = date.getTime() - todayDate.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  const weekday = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][date.getDay()];
  const timeSuffix = isValidHm(dt.time) ? ` ${dt.time}` : "";

  if (diffDays === 0) return `heute${timeSuffix}`;
  if (diffDays === 1) return `morgen${timeSuffix}`;
  if (diffDays === -1) return `gestern (überfällig)${timeSuffix}`;
  if (diffDays < -1) return `überfällig (seit ${-diffDays} Tagen)${timeSuffix}`;
  if (diffDays <= 6) return `in ${diffDays} Tagen (${weekday})${timeSuffix}`;
  if (diffDays <= 13) return `in 1 Woche (${weekday})${timeSuffix}`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks === 1) return `in 1 Woche (${weekday})${timeSuffix}`;
  return `in ${weeks} Wochen (${weekday})${timeSuffix}`;
}
