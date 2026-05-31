/**
 * NDJSON trace log for POST /api/todo-list/analyze (client body, Beeper, OpenAI, outcomes).
 * File: data/todo_list_analysis_trace.log (or BEEPER_CRM_DATA_DIR equivalent via ensureProjectDataDir).
 *
 * Enable: default ON in development, OFF in production unless TODO_ANALYSIS_TRACE=1|true.
 * Disable: TODO_ANALYSIS_TRACE=0|false
 *
 * Long strings are truncated to keep files bounded; Authorization is never written.
 */

import fs from "fs";
import path from "path";
import { beeperFetch, beeperJson, beeperUserErrorMessage } from "@/lib/beeper";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

const LOG_FILE = "todo_list_analysis_trace.log";
const MAX_BODY_CHARS = 14_000;
const MAX_PREVIEW_CHARS = 3_500;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

export function isTodoAnalysisTraceEnabled(): boolean {
  const v = process.env.TODO_ANALYSIS_TRACE?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  if (v === "1" || v === "true" || v === "on") return true;
  return process.env.NODE_ENV !== "production";
}

function getLogFilePath(): string {
  return path.join(ensureProjectDataDir(), LOG_FILE);
}

export function sanitizeTodoAnalyzeClientBody(body: Record<string, unknown>): Record<string, unknown> {
  const longTextKeys = new Set(["onePrompt", "promptSuffix"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (longTextKeys.has(k) && typeof v === "string") {
      out[k] = { length: v.length, preview: truncate(v, MAX_PREVIEW_CHARS) };
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Safe summary of OpenAI chat/completions payload for logs (no secrets). */
export function summarizeOpenAiChatPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const messages = payload.messages;
  const summarized: unknown[] = [];
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (!m || typeof m !== "object") {
        summarized.push(m);
        continue;
      }
      const msg = m as Record<string, unknown>;
      const role = msg.role;
      const content = msg.content;
      if (typeof content === "string") {
        summarized.push({
          role,
          contentLength: content.length,
          contentPreview: truncate(content, MAX_PREVIEW_CHARS),
        });
      } else {
        summarized.push({ role, content: content ?? null });
      }
    }
  }
  return {
    model: payload.model,
    temperature: payload.temperature,
    response_format: payload.response_format,
    messages: summarized,
  };
}

export function summarizeOpenAiResponseBody(data: unknown): Record<string, unknown> {
  const raw = JSON.stringify(data ?? null);
  return {
    length: raw.length,
    preview: truncate(raw, MAX_BODY_CHARS),
  };
}

export interface TodoAnalysisTraceLine {
  ts: string;
  chatId: string;
  accountId?: string | null;
  requestId?: string;
  phase: string;
  durationMs?: number;
  stream?: boolean;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: string;
  stackPreview?: string;
  [key: string]: unknown;
}

export function appendTodoAnalysisTrace(line: TodoAnalysisTraceLine): void {
  if (!isTodoAnalysisTraceEnabled()) return;
  try {
    const filePath = getLogFilePath();
    fs.appendFileSync(filePath, `${JSON.stringify(line)}\n`, "utf-8");
  } catch {
    try {
      fs.appendFileSync(path.join(process.cwd(), LOG_FILE), `${JSON.stringify(line)}\n`, "utf-8");
    } catch {
      // ignore
    }
  }
}

/** Same as beeperJson but records full response text preview (truncated) for todo analysis debugging. */
export async function todoAnalysisBeeperJson<T>(
  path: string,
  ctx: { chatId: string; phase: string; page?: number },
  options?: RequestInit
): Promise<T> {
  if (!isTodoAnalysisTraceEnabled()) {
    return beeperJson<T>(path, options);
  }

  const method = (options?.method ?? "GET").toUpperCase();
  const reqBody =
    typeof options?.body === "string" ? truncate(options.body, MAX_PREVIEW_CHARS) : options?.body != null ? "[non-string body]" : undefined;
  const t0 = Date.now();
  let status = 0;
  let text = "";
  try {
    const res = await beeperFetch(path, options);
    status = res.status;
    text = await res.text();
    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: ctx.chatId,
      phase: ctx.phase,
      upstream: "beeper",
      request: { path, method, bodyPreview: reqBody },
      response: {
        status,
        bodyLength: text.length,
        bodyPreview: truncate(text, MAX_BODY_CHARS),
        page: ctx.page,
      },
      durationMs: Date.now() - t0,
    });
    if (!res.ok) {
      throw new Error(beeperUserErrorMessage(path, status, text));
    }
    return JSON.parse(text) as T;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: ctx.chatId,
      phase: `${ctx.phase}_error`,
      upstream: "beeper",
      request: { path, method, bodyPreview: reqBody },
      response: status ? { status, bodyLength: text.length, bodyPreview: truncate(text, MAX_BODY_CHARS) } : undefined,
      error: err,
      stackPreview: e instanceof Error ? truncate(e.stack ?? "", 2000) : undefined,
      durationMs: Date.now() - t0,
      page: ctx.page,
    });
    throw e;
  }
}
