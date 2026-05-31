/**
 * Append-only log of prompts sent to OpenAI for todo list analysis.
 * Writes to data/todo_list_analysis_prompts.log so you can see exactly what is sent to ChatGPT.
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

const LOG_FILE = "todo_list_analysis_prompts.log";

function getLogFilePath(): string {
  return path.join(ensureProjectDataDir(), LOG_FILE);
}

/**
 * Append one prompt entry (system + user messages) to todo_list_analysis_prompts.log.
 */
export function logTodoListAnalysisPrompt(
  chatId: string,
  systemPrompt: string,
  userContent: string
): void {
  const filePath = getLogFilePath();
  const ts = new Date().toISOString();
  const block = [
    "",
    "========== TODO LIST ANALYSIS PROMPT (sent to OpenAI) ==========",
    `timestamp: ${ts}`,
    `chatId: ${chatId}`,
    "--- SYSTEM PROMPT ---",
    systemPrompt,
    "--- USER CONTENT ---",
    userContent,
    "================================================================",
    "",
  ].join("\n");

  try {
    fs.appendFileSync(filePath, block, "utf-8");
  } catch {
    try {
      fs.appendFileSync(path.join(process.cwd(), LOG_FILE), block, "utf-8");
    } catch {
      // ignore
    }
  }
}
