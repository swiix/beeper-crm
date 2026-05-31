/**
 * Append-only error log for todo list analysis (POST /api/todo-list/analyze).
 * Writes to data/todo_list_analysis_errors.log with input, output, and error details.
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

const LOG_FILE = "todo_list_analysis_errors.log";

function getLogFilePath(): string {
  return path.join(ensureProjectDataDir(), LOG_FILE);
}

export interface TodoListAnalysisErrorInput {
  chatId: string | null;
  accountId?: string | null;
  contactName?: string | null;
  messageCount?: number;
  transcriptLength?: number;
  /** Raw request body (sanitized: no huge payloads). */
  body?: Record<string, unknown>;
}

export interface TodoListAnalysisErrorOutput {
  /** HTTP status returned to client. */
  status: number;
  /** Error message returned to client. */
  error: string;
  /** If OpenAI returned an error or invalid JSON, include snippet (truncated). */
  openaiResponseSnippet?: string;
  /** Exception stack if caught. */
  stack?: string;
}

/**
 * Append one error entry to todo_list_analysis_errors.log.
 * Thread-safe in Node: appendFileSync is atomic for small appends.
 */
export function logTodoListAnalysisError(
  input: TodoListAnalysisErrorInput,
  output: TodoListAnalysisErrorOutput
): void {
  const filePath = getLogFilePath();
  const ts = new Date().toISOString();
  const inputJson = JSON.stringify(input, null, 2);
  const outputJson = JSON.stringify(output, null, 2);
  const block = [
    "",
    "========== TODO LIST ANALYSIS ERROR ==========",
    `timestamp: ${ts}`,
    "--- INPUT ---",
    inputJson,
    "--- OUTPUT / ERROR ---",
    outputJson,
    "==============================================",
    "",
  ].join("\n");

  try {
    fs.appendFileSync(filePath, block, "utf-8");
  } catch (e) {
    // Avoid throwing; main flow already returned error to client
    try {
      const fallback = path.join(process.cwd(), LOG_FILE);
      fs.appendFileSync(fallback, block, "utf-8");
    } catch {
      // ignore
    }
  }
}
