import { NextRequest, NextResponse } from "next/server";
import {
  fetchLatestChatMarker as fetchLatestMarkerShared,
  type BeeperMessagesResponse,
} from "@/lib/beeper-chat-messages";
import { createLogger } from "@/lib/logger";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { todoAnalysisBeeperJson } from "@/lib/todo-list-analysis-trace-log";
import type { TodoAnalyzeSettingsValues } from "@/components/todo/TodoAnalyzeSettingsForm";
import { estimateAnalyzeBatchCostUsd } from "@/lib/openai-cost";
import {
  estimateAnalyzeMinutes,
  isTodoAnalysisCacheFresh,
  resolveTodoAnalyzeRequestFromSettings,
  TODO_ANALYZE_PREVIEW_CONCURRENCY,
  TODO_ANALYZE_PREVIEW_MAX_CHATS,
} from "@/lib/todo-analysis-cache";
import { getTodoSuggestions } from "@/lib/todo-db";

type PreviewMessageItem = { sortKey?: string; timestamp?: string };

async function fetchLatestSortKeyForPreview(chatId: string): Promise<string | null> {
  const marker = await fetchLatestMarkerShared<PreviewMessageItem>(chatId, (path) =>
    todoAnalysisBeeperJson<BeeperMessagesResponse<PreviewMessageItem>>(path, {
      chatId,
      phase: "beeper_chat_marker",
    })
  );
  return marker.sortKey;
}

const log = createLogger("api:todo-list:analyze:preview");

function parseSettings(body: Record<string, unknown>): TodoAnalyzeSettingsValues | null {
  const s = body.settings;
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const scanMode = o.scanMode;
  if (scanMode !== "count" && scanMode !== "age" && scanMode !== "both") return null;
  return {
    promptSuffix: typeof o.promptSuffix === "string" ? o.promptSuffix : "",
    onePromptAllChats: typeof o.onePromptAllChats === "string" ? o.onePromptAllChats : "",
    scanMode,
    maxAgeValue: typeof o.maxAgeValue === "number" ? o.maxAgeValue : 30,
    maxAgeUnit:
      o.maxAgeUnit === "weeks" || o.maxAgeUnit === "months" ? o.maxAgeUnit : "days",
    maxMessages: typeof o.maxMessages === "number" ? o.maxMessages : 50,
    attachmentMode: o.attachmentMode === "fast" ? "fast" : "full",
    analyzeForce: o.analyzeForce === true,
  };
}

/**
 * POST /api/todo-list/analyze/preview
 * Body: { chatIds: string[], settings: TodoAnalyzeSettingsValues, forOnePrompt?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const settings = parseSettings(body);
    if (!settings) {
      return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
    }
    const rawIds = Array.isArray(body.chatIds) ? body.chatIds : [];
    const chatIds = rawIds
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim());
    const truncated = chatIds.length > TODO_ANALYZE_PREVIEW_MAX_CHATS;
    const ids = truncated ? chatIds.slice(0, TODO_ANALYZE_PREVIEW_MAX_CHATS) : chatIds;

    const resolved = resolveTodoAnalyzeRequestFromSettings(settings, {
      forOnePrompt: body.forOnePrompt === true,
    });

    const counts = { cacheFresh: 0, withSuggestions: 0, needsAnalyze: 0 };

    if (resolved.force || resolved.onePromptMode) {
      counts.needsAnalyze = ids.length;
      for (const chatId of ids) {
        const cached = getTodoSuggestions(chatId);
        if (cached?.todos?.length) counts.withSuggestions += 1;
      }
    } else {
      await runWithConcurrency(TODO_ANALYZE_PREVIEW_CONCURRENCY, ids, async (chatId) => {
        const cached = getTodoSuggestions(chatId);
        if (cached?.todos?.length) counts.withSuggestions += 1;
        const fresh = await isTodoAnalysisCacheFresh(chatId, resolved, fetchLatestSortKeyForPreview);
        if (fresh) counts.cacheFresh += 1;
        else counts.needsAnalyze += 1;
      });
    }

    const { cacheFresh, withSuggestions, needsAnalyze } = counts;

    const total = chatIds.length;
    const estimatedMinutes = estimateAnalyzeMinutes(needsAnalyze);
    const estimated_cost_usd = estimateAnalyzeBatchCostUsd({
      chatsToAnalyze: needsAnalyze,
      maxMessages: resolved.maxMessages,
      attachmentMode: resolved.attachmentMode,
    });

    return NextResponse.json({
      total,
      previewed: ids.length,
      truncated,
      withSuggestions,
      cacheFresh,
      needsAnalyze,
      estimatedMinutes,
      estimated_cost_usd,
      attachmentMode: resolved.attachmentMode,
      force: resolved.force,
      onePromptMode: resolved.onePromptMode,
    });
  } catch (e) {
    log.error({ err: e }, "analyze preview failed");
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}
