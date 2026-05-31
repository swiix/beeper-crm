import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { readPrompts, writePrompts, type StoredPrompts } from "@/lib/prompts-store";

const log = createLogger("api:settings:prompts");

/**
 * GET: return saved analysis prompts (system prompt). Returns default when not set.
 */
export async function GET() {
  try {
    const prompts = readPrompts();
    return NextResponse.json(prompts);
  } catch (e) {
    log.error({ err: e }, "GET prompts failed");
    return NextResponse.json({ error: "Failed to read prompts" }, { status: 500 });
  }
}

/**
 * PUT: save prompts. Body: { analysisSystemPrompt?: string, quickReplyPromptSuffix?: string, tinderSuggestionsCount?: number, tinderPromptSuffix?: string, tinderSummaryPromptSuffix?: string }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const current = readPrompts();
    const tinderCount = body?.tinderSuggestionsCount;
    const next: StoredPrompts = {
      analysisSystemPrompt:
        typeof body?.analysisSystemPrompt === "string"
          ? body.analysisSystemPrompt
          : current.analysisSystemPrompt,
      quickReplyPromptSuffix:
        typeof body?.quickReplyPromptSuffix === "string"
          ? body.quickReplyPromptSuffix
          : current.quickReplyPromptSuffix,
      tinderSuggestionsCount:
        typeof tinderCount === "number" && !Number.isNaN(tinderCount)
          ? Math.min(10, Math.max(1, Math.round(tinderCount)))
          : (current.tinderSuggestionsCount ?? 5),
      tinderPromptSuffix:
        typeof body?.tinderPromptSuffix === "string" ? body.tinderPromptSuffix : current.tinderPromptSuffix,
      tinderSummaryPromptSuffix:
        typeof body?.tinderSummaryPromptSuffix === "string"
          ? body.tinderSummaryPromptSuffix
          : current.tinderSummaryPromptSuffix,
    };
    writePrompts(next);
    log.info("prompts saved");
    return NextResponse.json(next);
  } catch (e) {
    log.error({ err: e }, "PUT prompts failed");
    return NextResponse.json({ error: "Failed to save prompts" }, { status: 500 });
  }
}
