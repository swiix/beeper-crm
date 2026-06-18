/**
 * Reclaim HTTP API client (https://api.app.reclaim.ai).
 * Uses a user-provided API token — not the Python reclaim-sdk package.
 */

import { getReclaimApiToken } from "@/lib/reclaim-settings";
import { resolveEstimatedTimeMinutes } from "@/lib/todo-duration";
import type { TodoItem } from "@/lib/todo-db";

const RECLAIM_API_BASE = "https://api.app.reclaim.ai";

export type ReclaimPriority = "P1" | "P2" | "P3" | "P4";

export type ReclaimConnectionStatus = {
  connected: boolean;
  email?: string | null;
  userId?: number | null;
};

export type CreateReclaimTaskInput = {
  title: string;
  notes?: string | null;
  due?: string | null;
  priority?: ReclaimPriority | null;
  durationHours?: number | null;
  /** Mark task as Up Next (on deck) in Reclaim. */
  onDeck?: boolean;
};

export type ReclaimTaskCreated = {
  id: number;
  title?: string | null;
};

type ReclaimApiError = {
  message?: string;
};

function getToken(): string | null {
  return getReclaimApiToken();
}

async function reclaimRequest<T>(
  method: string,
  endpoint: string,
  options?: { params?: Record<string, string>; body?: unknown; token?: string | null }
): Promise<T> {
  const token = options?.token?.trim() || getToken();
  if (!token) throw new Error("Reclaim is not connected. Please add an API token in Settings.");

  const url = new URL(endpoint, RECLAIM_API_BASE);
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: options?.body != null ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Reclaim API error (${response.status})`;
    try {
      const err = (await response.json()) as ReclaimApiError;
      if (err.message) message = err.message;
    } catch {
      // ignore parse errors
    }
    if (response.status === 401) {
      throw new Error("Reclaim authentication failed. Check your API token in Settings.");
    }
    throw new Error(message);
  }

  if (response.status === 204 || !response.headers.get("content-length")) {
    return {} as T;
  }
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function getReclaimConnectionStatus(): ReclaimConnectionStatus {
  const token = getToken();
  if (!token) return { connected: false };
  return { connected: true };
}

export async function verifyReclaimConnection(tokenOverride?: string | null): Promise<ReclaimConnectionStatus> {
  const token = tokenOverride?.trim() || getToken();
  if (!token) return { connected: false };
  try {
    const user = await reclaimRequest<{ id?: number; email?: string }>("GET", "/api/users/current", {
      token,
    });
    return {
      connected: true,
      email: user.email ?? null,
      userId: typeof user.id === "number" ? user.id : null,
    };
  } catch {
    return { connected: false };
  }
}

export function mapCrmPriorityToReclaim(priority: number | null | undefined): ReclaimPriority | null {
  if (priority == null || !Number.isFinite(priority)) return null;
  const value = Math.max(1, Math.min(5, Math.round(priority)));
  if (value >= 5) return "P1";
  if (value >= 4) return "P2";
  if (value >= 3) return "P3";
  return "P4";
}

export function durationHoursToChunks(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 1;
  return Math.max(1, Math.round(hours * 4));
}

export function formatReclaimDueIso(todo: Pick<TodoItem, "due_date" | "due_at">): string | null {
  if (todo.due_at != null && Number.isFinite(todo.due_at)) {
    return new Date(todo.due_at).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (todo.due_date && /^\d{4}-\d{2}-\d{2}$/.test(todo.due_date)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todo.due_date);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    return new Date(y, mo, day, 20, 0, 0, 0).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return null;
}

export function buildReclaimTaskPayload(input: CreateReclaimTaskInput): Record<string, unknown> {
  const title = input.title.trim();
  if (!title) throw new Error("Todo title is required for Reclaim sync.");

  const payload: Record<string, unknown> = {
    title,
    eventCategory: "WORK",
  };

  if (input.notes?.trim()) payload.notes = input.notes.trim();
  if (input.due) payload.due = input.due;
  if (input.priority) payload.priority = input.priority;

  const hours = input.durationHours;
  if (hours != null && Number.isFinite(hours) && hours > 0) {
    payload.timeChunksRequired = durationHoursToChunks(hours);
  }

  if (input.onDeck === true) payload.onDeck = true;

  return payload;
}

export async function createReclaimTask(input: CreateReclaimTaskInput): Promise<ReclaimTaskCreated> {
  const payload = buildReclaimTaskPayload(input);
  const data = await reclaimRequest<{ id?: number; title?: string }>("POST", "/api/tasks", { body: payload });
  if (typeof data.id !== "number") {
    throw new Error("Reclaim did not return a task id.");
  }
  return { id: data.id, title: data.title ?? input.title };
}

export async function patchReclaimTask(reclaimTaskId: number, input: CreateReclaimTaskInput): Promise<void> {
  const payload = buildReclaimTaskPayload(input);
  await reclaimRequest("PATCH", `/api/tasks/${reclaimTaskId}`, { body: payload });
}

export function todoToReclaimTaskInput(
  todo: TodoItem,
  defaultDurationHours?: number,
  options?: { markAsNext?: boolean }
): CreateReclaimTaskInput {
  const minutes = resolveEstimatedTimeMinutes(todo.estimated_time_minutes, defaultDurationHours);
  return {
    title: todo.title,
    notes: todo.notes,
    due: formatReclaimDueIso(todo),
    priority: mapCrmPriorityToReclaim(todo.priority),
    durationHours: minutes / 60,
    onDeck: options?.markAsNext ? true : undefined,
  };
}
