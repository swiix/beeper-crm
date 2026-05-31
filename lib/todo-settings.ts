/**
 * Todo list feature settings: prompt, message limit, default deadline days.
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";
import { MAX_CHAT_MESSAGES } from "@/lib/chat-message-limits";

export const DEFAULT_TODO_LIST_MESSAGE_LIMIT = 20;
export const MIN_TODO_MESSAGE_LIMIT = 0;
export const MAX_TODO_MESSAGE_LIMIT = MAX_CHAT_MESSAGES;
export const DEFAULT_TODO_DEFAULT_DEADLINE_DAYS = 3;
export const MIN_DEADLINE_DAYS = 1;
export const MAX_DEADLINE_DAYS = 30;
export const DEFAULT_TODO_MESSAGE_SCAN_MODE = "both" as const;
export const DEFAULT_TODO_MAX_MESSAGE_AGE_DAYS = 30;
export const DEFAULT_AUTO_SYNC_ON_ACCEPT = true;
export const DEFAULT_TODO_SYNC_TARGET = "google" as const;
export type TodoSyncTarget = "google" | "reclaim";
/** @deprecated migrated to todoSyncTarget + autoSyncOnAccept */
export const DEFAULT_AUTO_SYNC_GOOGLE_TASKS_ON_ACCEPT = true;
/** @deprecated migrated to todoSyncTarget + autoSyncOnAccept */
export const DEFAULT_AUTO_SYNC_RECLAIM_ON_ACCEPT = false;
export const DEFAULT_TODO_DEFAULT_DURATION_HOURS = 0.25;
export const MIN_TODO_DEFAULT_DURATION_HOURS = 0.05;
export const MAX_TODO_DEFAULT_DURATION_HOURS = 24;
export const MIN_TODO_MAX_MESSAGE_AGE_DAYS = 1;
export const MAX_TODO_MAX_MESSAGE_AGE_DAYS = 3650;

export const DEFAULT_TODO_LIST_PROMPT = `Erstelle eine ToDo-Liste für den Nutzer basierend auf dem folgenden Chat-Verlauf.
Antworte NUR mit einem einzelnen JSON-Objekt in diesem Format (kein anderer Text, kein Markdown):
{ "todos": [ { "title": "Kurzer Todo-Titel", "due": "YYYY-MM-DD" oder null, "priority": 1-5 (1=niedrig, 5=hoch), "notes": "Kontext aus dem Chat", "category": "Arbeit" oder "Privat" oder "Follow-up" oder null, "estimated_time_hours": Zahl oder null } ] }

Regeln:
- title: Kurze, klare Aufgabenbeschreibung (Pflicht). Wenn ein Kontaktname angegeben ist, beginne jeden title mit "Vorname: " (nur das erste Wort des Kontaktnamens als Vorname), z.B. "Nina: Rückruf bis Freitag".
- due: Wenn im Chat ein Datum, eine Frist oder Formulierungen wie "bis Freitag", "nächste Woche" vorkommen, setze das passende ISO-Datum (YYYY-MM-DD). Sonst null. Nutze das angegebene "Heutiges Datum" für relative Angaben.
- priority: 1-5 aus dem Kontext (dringend/wichtig = höher; "wenn Zeit" = niedriger). Default 3 wenn unklar.
- notes: Immer einen kurzen Kontextsatz aus dem Chat angeben (Pflicht). Am Ende der Notiz die zugrundeliegenden Nachrichten wörtlich zitieren unter der Zeile "Extrahiert aus:" (eine oder mehrere relevante Originalzitate aus dem Verlauf). Beispiel: "Max bat um Rückruf bis Freitag. Extrahiert aus: [Datum] Max: Kannst du mich bis Freitag zurückrufen?" So behält der Nutzer den Bezug zum Chat.
- category: Optional "Arbeit", "Privat" oder "Follow-up" wenn aus dem Chat erkennbar. Sonst null.
- estimated_time_hours: Geschätzte Zeit zur Erledigung in Stunden (nur Zahl, z.B. 0.25, 0.5, 1, 1.5, 2). Schätze realistisch aus dem Kontext. Wenn unklar oder nicht abschätzbar: null.
Antworte nur mit dem JSON.`;

export interface TodoSettings {
  todoListPrompt: string;
  todoListMessageLimit: number;
  todoListDefaultDeadlineDays: number;
  /** "count" = only last X messages, "age" = only messages newer than X days, "both" = intersection. */
  todoListMessageScanMode: "count" | "age" | "both";
  /** Max age in days for age/both mode. */
  todoListMaxMessageAgeDays: number;
  /** External sync target: exactly one of Google Tasks or Reclaim. */
  todoSyncTarget: TodoSyncTarget;
  /** Sync to todoSyncTarget when accepting a todo suggestion. */
  autoSyncOnAccept: boolean;
  /** Default estimated duration in hours when none is set on a todo. */
  todoListDefaultDurationHours: number;
}

function defaultTodoSettings(): TodoSettings {
  return {
    todoListPrompt: DEFAULT_TODO_LIST_PROMPT,
    todoListMessageLimit: DEFAULT_TODO_LIST_MESSAGE_LIMIT,
    todoListDefaultDeadlineDays: DEFAULT_TODO_DEFAULT_DEADLINE_DAYS,
    todoListMessageScanMode: DEFAULT_TODO_MESSAGE_SCAN_MODE,
    todoListMaxMessageAgeDays: DEFAULT_TODO_MAX_MESSAGE_AGE_DAYS,
    todoSyncTarget: DEFAULT_TODO_SYNC_TARGET,
    autoSyncOnAccept: DEFAULT_AUTO_SYNC_ON_ACCEPT,
    todoListDefaultDurationHours: DEFAULT_TODO_DEFAULT_DURATION_HOURS,
  };
}

function parseTodoSyncTarget(value: unknown, legacy?: Record<string, unknown>): TodoSyncTarget {
  if (value === "google" || value === "reclaim") return value;
  if (legacy) {
    const reclaim = legacy.autoSyncReclaimOnAccept === true;
    const google = legacy.autoSyncGoogleTasksOnAccept !== false;
    if (reclaim && !google) return "reclaim";
  }
  return DEFAULT_TODO_SYNC_TARGET;
}

function parseAutoSyncOnAccept(value: unknown, legacy?: Record<string, unknown>, target?: TodoSyncTarget): boolean {
  if (typeof value === "boolean") return value;
  if (legacy && target) {
    if (target === "reclaim") {
      return typeof legacy.autoSyncReclaimOnAccept === "boolean"
        ? legacy.autoSyncReclaimOnAccept
        : DEFAULT_AUTO_SYNC_RECLAIM_ON_ACCEPT;
    }
    return typeof legacy.autoSyncGoogleTasksOnAccept === "boolean"
      ? legacy.autoSyncGoogleTasksOnAccept
      : DEFAULT_AUTO_SYNC_GOOGLE_TASKS_ON_ACCEPT;
  }
  return DEFAULT_AUTO_SYNC_ON_ACCEPT;
}

function parseTodoListDefaultDurationHours(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(
      MAX_TODO_DEFAULT_DURATION_HOURS,
      Math.max(MIN_TODO_DEFAULT_DURATION_HOURS, Number(value.toFixed(2)))
    );
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(",", "."));
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.min(
        MAX_TODO_DEFAULT_DURATION_HOURS,
        Math.max(MIN_TODO_DEFAULT_DURATION_HOURS, Number(parsed.toFixed(2)))
      );
    }
  }
  return DEFAULT_TODO_DEFAULT_DURATION_HOURS;
}

const FILE_NAME = "todo-settings.json";

function getFilePath(): string {
  return path.join(ensureProjectDataDir(), FILE_NAME);
}

export function readTodoSettings(): TodoSettings {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) {
      return defaultTodoSettings();
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return defaultTodoSettings();
    }
    const p = parsed as Record<string, unknown>;
    const todoSyncTarget = parseTodoSyncTarget(p.todoSyncTarget, p);
    const limit =
      typeof p.todoListMessageLimit === "number" && !Number.isNaN(p.todoListMessageLimit)
        ? Math.min(MAX_TODO_MESSAGE_LIMIT, Math.max(MIN_TODO_MESSAGE_LIMIT, Math.round(p.todoListMessageLimit)))
        : DEFAULT_TODO_LIST_MESSAGE_LIMIT;
    const days =
      typeof p.todoListDefaultDeadlineDays === "number" && !Number.isNaN(p.todoListDefaultDeadlineDays)
        ? Math.min(MAX_DEADLINE_DAYS, Math.max(MIN_DEADLINE_DAYS, Math.round(p.todoListDefaultDeadlineDays)))
        : DEFAULT_TODO_DEFAULT_DEADLINE_DAYS;
    const scanMode =
      p.todoListMessageScanMode === "count" || p.todoListMessageScanMode === "age" || p.todoListMessageScanMode === "both"
        ? p.todoListMessageScanMode
        : DEFAULT_TODO_MESSAGE_SCAN_MODE;
    const maxAgeDays =
      typeof p.todoListMaxMessageAgeDays === "number" && !Number.isNaN(p.todoListMaxMessageAgeDays)
        ? Math.min(MAX_TODO_MAX_MESSAGE_AGE_DAYS, Math.max(MIN_TODO_MAX_MESSAGE_AGE_DAYS, Math.round(p.todoListMaxMessageAgeDays)))
        : DEFAULT_TODO_MAX_MESSAGE_AGE_DAYS;
    return {
      todoListPrompt: typeof p.todoListPrompt === "string" && p.todoListPrompt.trim() ? p.todoListPrompt : DEFAULT_TODO_LIST_PROMPT,
      todoListMessageLimit: limit,
      todoListDefaultDeadlineDays: days,
      todoListMessageScanMode: scanMode,
      todoListMaxMessageAgeDays: maxAgeDays,
      todoSyncTarget,
      autoSyncOnAccept: parseAutoSyncOnAccept(p.autoSyncOnAccept, p, todoSyncTarget),
      todoListDefaultDurationHours: parseTodoListDefaultDurationHours(p.todoListDefaultDurationHours),
    };
  } catch {
    return defaultTodoSettings();
  }
}

export function writeTodoSettings(settings: TodoSettings): void {
  const filePath = getFilePath();
  const safe: TodoSettings = {
    todoListPrompt: settings.todoListPrompt.trim() || DEFAULT_TODO_LIST_PROMPT,
    todoListMessageLimit: Math.min(MAX_TODO_MESSAGE_LIMIT, Math.max(MIN_TODO_MESSAGE_LIMIT, Math.round(settings.todoListMessageLimit))),
    todoListDefaultDeadlineDays: Math.min(MAX_DEADLINE_DAYS, Math.max(MIN_DEADLINE_DAYS, Math.round(settings.todoListDefaultDeadlineDays))),
    todoListMessageScanMode:
      settings.todoListMessageScanMode === "count" || settings.todoListMessageScanMode === "age" || settings.todoListMessageScanMode === "both"
        ? settings.todoListMessageScanMode
        : DEFAULT_TODO_MESSAGE_SCAN_MODE,
    todoListMaxMessageAgeDays: Math.min(
      MAX_TODO_MAX_MESSAGE_AGE_DAYS,
      Math.max(MIN_TODO_MAX_MESSAGE_AGE_DAYS, Math.round(settings.todoListMaxMessageAgeDays))
    ),
    todoSyncTarget: settings.todoSyncTarget === "reclaim" ? "reclaim" : "google",
    autoSyncOnAccept: !!settings.autoSyncOnAccept,
    todoListDefaultDurationHours: parseTodoListDefaultDurationHours(settings.todoListDefaultDurationHours),
  };
  fs.writeFileSync(filePath, JSON.stringify(safe, null, 2), "utf-8");
}
