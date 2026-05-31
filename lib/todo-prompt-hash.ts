/**
 * Hash for todo-list analysis cache: prompt, scan scope, and attachment mode.
 */

import { createHash } from "crypto";

export const TODO_ANALYSIS_MODEL = process.env.OPENAI_TODO_MODEL ?? "gpt-4o-mini";

function sha256Short(payload: string): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export function computeTodoAnalysisPromptHash(params: {
  systemPrompt: string;
  mode: string;
  maxCount: number | null;
  minTimestampMs: number | null;
  attachmentMode: "fast" | "full";
  onePrompt?: string | null;
}): string {
  const payload = JSON.stringify({
    model: TODO_ANALYSIS_MODEL,
    systemPrompt: params.systemPrompt,
    mode: params.mode,
    maxCount: params.maxCount,
    minTimestampMs: params.minTimestampMs,
    attachmentMode: params.attachmentMode,
    onePrompt: params.onePrompt ?? null,
  });
  return sha256Short(payload);
}
