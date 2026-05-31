/**
 * Stable hashes for analysis cache invalidation when prompts, model, or view config change.
 */

import { createHash } from "crypto";
import {
  readPrompts,
  DEFAULT_TINDER_SUGGESTIONS_COUNT,
} from "@/lib/prompts-store";

/** Model used by analyze-chat (must match API route). */
export const ANALYSIS_CHAT_MODEL =
  process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-4o-mini";

function sha256Short(payload: string): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/**
 * Hash for chat analysis (CRM / Tinder). Static prompt + model + view (not contact name,
 * so GET without contactName still matches POST cache).
 */
export function computeAnalysisPromptHash(isTinder: boolean, suggestionsCount: number): string {
  const p = readPrompts();
  const payload = JSON.stringify({
    model: ANALYSIS_CHAT_MODEL,
    view: isTinder ? "tinder" : "default",
    suggestionsCount,
    analysisSystemPrompt: p.analysisSystemPrompt,
    quickReplyPromptSuffix: p.quickReplyPromptSuffix ?? "",
    tinderSuggestionsCount: p.tinderSuggestionsCount ?? DEFAULT_TINDER_SUGGESTIONS_COUNT,
    tinderPromptSuffix: p.tinderPromptSuffix ?? "",
    tinderSummaryPromptSuffix: p.tinderSummaryPromptSuffix ?? "",
  });
  return sha256Short(payload);
}
