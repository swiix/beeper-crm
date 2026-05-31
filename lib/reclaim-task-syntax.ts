type ReclaimPriority = "low" | "medium" | "high" | "critical";

export interface ReclaimTodoInput {
  title: string;
  due_date?: string | null;
  priority?: number | null;
  estimated_time_minutes?: number | null;
}

function mapPriority(priority: number | null | undefined): ReclaimPriority | null {
  if (priority == null || !Number.isFinite(priority)) return null;
  const value = Math.max(1, Math.min(5, Math.round(priority)));
  if (value <= 1) return "low";
  if (value <= 3) return "medium";
  if (value <= 4) return "high";
  return "critical";
}

function formatDuration(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes % 60 === 0) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes)}m`;
}

export function buildReclaimTaskTitle(input: ReclaimTodoInput): string {
  const baseTitle = input.title.trim();
  if (!baseTitle) {
    throw new Error("Todo title is required for Reclaim syntax.");
  }

  const tokens: string[] = [];
  const durationToken = input.estimated_time_minutes != null ? formatDuration(input.estimated_time_minutes) : null;
  if (durationToken) tokens.push(`duration:${durationToken}`);
  if (input.due_date && /^\d{4}-\d{2}-\d{2}$/.test(input.due_date)) tokens.push(`due ${input.due_date}`);
  const priority = mapPriority(input.priority);
  if (priority) tokens.push(`priority:${priority}`);

  if (tokens.length === 0) return baseTitle;
  return `${baseTitle} (${tokens.join(" ")})`;
}
