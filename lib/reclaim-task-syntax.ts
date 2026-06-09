import type { TodoItem } from "@/lib/todo-db";

export type ReclaimScheduleType = "work" | "personal";
export type ReclaimSyntaxPriority = "low" | "medium" | "high" | "critical";

const LEGACY_UPNEXT_PREFIX = /^upnext\s+/i;
const RECLAIM_PAREN_TOKEN =
  /\b(type|due|not before|priority:|upnext|up next|duration:|nosplit)\b/i;

/** Remove legacy prefix and trailing Reclaim paren syntax from a raw title. */
export function stripReclaimSyntaxFromBaseTitle(title: string): string {
  let base = title.trim();
  if (!base) return base;

  if (LEGACY_UPNEXT_PREFIX.test(base)) {
    base = base.replace(LEGACY_UPNEXT_PREFIX, "").trim();
  }

  const parenMatch = base.match(/^(.*)\s+\(([^)]+)\)\s*$/);
  if (parenMatch && RECLAIM_PAREN_TOKEN.test(parenMatch[2])) {
    base = parenMatch[1].trim();
  }

  return base;
}

/** Fields used to build Reclaim-compatible Google Tasks title syntax. */
export interface ReclaimTodoInput {
  title: string;
  due_date?: string | null;
  /** Natural-language due (e.g. "tomorrow", "next monday"). Overrides due_date. */
  due_phrase?: string | null;
  not_before?: string | null;
  /** Natural-language not-before phrase. Overrides not_before date. */
  not_before_phrase?: string | null;
  priority?: number | null;
  estimated_time_minutes?: number | null;
  mark_as_next?: boolean;
  schedule_type?: ReclaimScheduleType | null;
  no_split?: boolean;
  /** Maps Privat/Arbeit category to personal/work when schedule_type is unset. */
  category?: string | null;
}

export type ReclaimSyntaxFields = {
  mark_as_next?: boolean;
  reclaim_schedule_type?: ReclaimScheduleType | null;
  reclaim_not_before?: string | null;
  reclaim_no_split?: boolean;
};

function mapPriority(priority: number | null | undefined): ReclaimSyntaxPriority | null {
  if (priority == null || !Number.isFinite(priority)) return null;
  const value = Math.max(1, Math.min(5, Math.round(priority)));
  if (value <= 1) return "low";
  if (value <= 3) return "medium";
  if (value <= 4) return "high";
  return "critical";
}

export function scheduleTypeFromCategory(category?: string | null): ReclaimScheduleType | null {
  if (!category?.trim()) return null;
  const c = category.trim().toLowerCase();
  if (c.includes("privat") || c.includes("personal")) return "personal";
  if (c.includes("arbeit") || c.includes("work")) return "work";
  return null;
}

function resolveScheduleType(input: ReclaimTodoInput): ReclaimScheduleType | null {
  if (input.schedule_type === "work" || input.schedule_type === "personal") return input.schedule_type;
  return scheduleTypeFromCategory(input.category);
}

function formatDuration(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);
  if (rounded % 60 === 0) return `${rounded / 60}h`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

function formatDueToken(input: ReclaimTodoInput): string | null {
  const phrase = input.due_phrase?.trim();
  if (phrase) return `due ${phrase}`;
  if (input.due_date && /^\d{4}-\d{2}-\d{2}$/.test(input.due_date)) return `due ${input.due_date}`;
  return null;
}

function formatNotBeforeToken(input: ReclaimTodoInput): string | null {
  const phrase = input.not_before_phrase?.trim();
  if (phrase) return `not before ${phrase}`;
  if (input.not_before && /^\d{4}-\d{2}-\d{2}$/.test(input.not_before)) return `not before ${input.not_before}`;
  return null;
}

/** Build Google Tasks title with Reclaim parsing syntax in trailing parentheses. */
export function buildReclaimTaskTitle(input: ReclaimTodoInput): string {
  const baseTitle = stripReclaimSyntaxFromBaseTitle(input.title);
  if (!baseTitle) {
    throw new Error("Todo title is required for Reclaim syntax.");
  }

  const tokens: string[] = [];

  const scheduleType = resolveScheduleType(input);
  if (scheduleType) tokens.push(`type ${scheduleType}`);

  const dueToken = formatDueToken(input);
  if (dueToken) tokens.push(dueToken);

  const notBeforeToken = formatNotBeforeToken(input);
  if (notBeforeToken) tokens.push(notBeforeToken);

  const priority = mapPriority(input.priority);
  if (priority) tokens.push(`priority:${priority}`);

  if (input.mark_as_next) tokens.push("upnext");

  const durationToken =
    input.estimated_time_minutes != null ? formatDuration(input.estimated_time_minutes) : null;
  if (durationToken) tokens.push(`duration:${durationToken}`);

  if (input.no_split) tokens.push("nosplit");

  if (tokens.length === 0) return baseTitle;
  return `${baseTitle} (${tokens.join(" ")})`;
}

export function parseReclaimSyntaxFromRecord(raw: Record<string, unknown>): {
  mark_as_next: boolean;
  reclaim_schedule_type: ReclaimScheduleType | null;
  reclaim_not_before: string | null;
  reclaim_no_split: boolean;
  category: string | null;
} {
  const scheduleRaw = raw.reclaim_schedule_type;
  const scheduleType =
    scheduleRaw === "work" || scheduleRaw === "personal" ? scheduleRaw : null;
  const notBefore =
    typeof raw.reclaim_not_before === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.reclaim_not_before)
      ? raw.reclaim_not_before
      : null;
  return {
    mark_as_next: raw.mark_as_next === true || raw.mark_as_next === 1 || raw.mark_as_next === "true",
    reclaim_schedule_type: scheduleType,
    reclaim_not_before: notBefore,
    reclaim_no_split: raw.reclaim_no_split === true || raw.reclaim_no_split === 1 || raw.reclaim_no_split === "true",
    category: typeof raw.category === "string" ? raw.category : null,
  };
}

export function suggestionToCreateTodoSyntax(
  suggestion: ReclaimSyntaxFields & { category?: string | null }
): {
  mark_as_next?: boolean;
  reclaim_schedule_type?: ReclaimScheduleType | null;
  reclaim_not_before?: string | null;
  reclaim_no_split?: boolean;
  category?: string | null;
} {
  const fields = suggestionToSyntaxFields(suggestion);
  return {
    mark_as_next: fields.mark_as_next ? true : undefined,
    reclaim_schedule_type: fields.reclaim_schedule_type ?? undefined,
    reclaim_not_before: fields.reclaim_not_before ?? undefined,
    reclaim_no_split: fields.reclaim_no_split ? true : undefined,
    category: suggestion.category ?? undefined,
  };
}

export function suggestionToSyntaxFields(
  suggestion: ReclaimSyntaxFields & { category?: string | null }
): ReclaimSyntaxFields {
  return {
    mark_as_next: suggestion.mark_as_next === true,
    reclaim_schedule_type: suggestion.reclaim_schedule_type ?? null,
    reclaim_not_before: suggestion.reclaim_not_before ?? null,
    reclaim_no_split: suggestion.reclaim_no_split === true,
  };
}

export function reclaimSyntaxFieldsToInput(
  fields: ReclaimSyntaxFields | null | undefined
): Pick<ReclaimTodoInput, "mark_as_next" | "schedule_type" | "not_before" | "no_split"> {
  if (!fields) return {};
  return {
    mark_as_next: fields.mark_as_next === true,
    schedule_type: fields.reclaim_schedule_type ?? null,
    not_before: fields.reclaim_not_before ?? null,
    no_split: fields.reclaim_no_split === true,
  };
}

export function todoItemToReclaimSyntaxInput(
  todo: Pick<
    TodoItem,
    | "title"
    | "due_date"
    | "priority"
    | "estimated_time_minutes"
    | "sync_upnext"
    | "sync_schedule_type"
    | "sync_not_before"
    | "sync_no_split"
  >,
  estimatedMinutes: number
): ReclaimTodoInput {
  return {
    title: todo.title,
    due_date: todo.due_date,
    priority: todo.priority,
    estimated_time_minutes: estimatedMinutes,
    mark_as_next: todo.sync_upnext === 1,
    schedule_type:
      todo.sync_schedule_type === "work" || todo.sync_schedule_type === "personal"
        ? todo.sync_schedule_type
        : null,
    not_before: todo.sync_not_before,
    no_split: todo.sync_no_split === 1,
  };
}
