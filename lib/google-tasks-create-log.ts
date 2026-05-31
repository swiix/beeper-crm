/**
 * Append-only log of successfully created Google Tasks (for validating Reclaim title syntax).
 * File: <data dir>/google_tasks_created.log
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

const LOG_FILENAME = "google_tasks_created.log";

export interface GoogleTaskCreateLogEntry {
  todoId: string;
  /** Raw todo title in CRM before Reclaim wrapping */
  crmTitleRaw: string;
  /** Exact title string sent to Google Tasks API */
  sentTitleExact: string;
  dueDateYmd: string | null;
  priority: number | null;
  estimatedTimeMinutes: number | null;
  googleTaskId: string;
  googleWebViewLink: string | null;
}

function getLogPath(): string {
  return path.join(ensureProjectDataDir(), LOG_FILENAME);
}

/** Record one successful Google Task creation (best-effort; never throws to callers). */
export function appendGoogleTaskCreateLog(entry: GoogleTaskCreateLogEntry): void {
  try {
    const ts = new Date().toISOString();
    const block = [
      "----------",
      ts,
      `todo_id: ${entry.todoId}`,
      `crm_title_raw: ${entry.crmTitleRaw}`,
      `sent_title_exact: ${entry.sentTitleExact}`,
      `due_date_ymd: ${entry.dueDateYmd ?? "(none)"}`,
      `priority: ${entry.priority != null ? String(entry.priority) : "(none)"}`,
      `estimated_time_minutes: ${entry.estimatedTimeMinutes != null ? String(entry.estimatedTimeMinutes) : "(none)"}`,
      `google_task_id: ${entry.googleTaskId}`,
      `google_web_view_link: ${entry.googleWebViewLink ?? "(none)"}`,
      "",
      "",
    ].join("\n");
    fs.appendFileSync(getLogPath(), block, { encoding: "utf-8" });
  } catch {
    // Logging must never break sync
  }
}
