import { NextRequest, NextResponse } from "next/server";
import type { ContactAnalysis } from "@/lib/types";
import { createLogger } from "@/lib/logger";
import { prewarmTranscriptsForChat } from "@/lib/chat-transcribe-prewarm";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { readRules } from "@/lib/rules-store";

const log = createLogger("api:tinder:batch-analyze");

const DEFAULT_TINDER_BATCH_CONCURRENCY = 10;

type BatchResult = { chatId: string; data: ContactAnalysis | null; error?: string };

/**
 * POST /api/tinder/batch-analyze
 * Pipelines transcript prewarm + analyze-chat per chat with bounded concurrency.
 * Body: { chatIds: string[], concurrency?: number }
 */
export async function POST(request: NextRequest) {
  let body: { chatIds?: string[]; concurrency?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const chatIds = Array.isArray(body.chatIds)
    ? body.chatIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  if (chatIds.length === 0) {
    return NextResponse.json({ results: [] as BatchResult[] });
  }

  const rules = readRules();
  const fromBody =
    typeof body.concurrency === "number" && !Number.isNaN(body.concurrency)
      ? Math.round(body.concurrency)
      : null;
  const concurrency = Math.max(
    1,
    Math.min(50, fromBody ?? rules.analysisConcurrency ?? DEFAULT_TINDER_BATCH_CONCURRENCY)
  );

  const origin = request.nextUrl.origin;
  const results: BatchResult[] = chatIds.map((chatId) => ({ chatId, data: null }));

  await runWithConcurrency(concurrency, chatIds, async (chatId, index) => {
    try {
      await prewarmTranscriptsForChat(chatId);
      const res = await fetch(`${origin}/api/analyze-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          view: "tinder",
          source: "tinder-batch-prefetch",
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        results[index] = {
          chatId,
          data: null,
          error: errBody.error ?? `Analyze failed (${res.status})`,
        };
        return;
      }
      const data = (await res.json()) as ContactAnalysis;
      results[index] = { chatId, data };
    } catch (e) {
      results[index] = {
        chatId,
        data: null,
        error: e instanceof Error ? e.message : "Batch analyze failed",
      };
    }
  });

  log.info(
    {
      total: chatIds.length,
      concurrency,
      ok: results.filter((r) => r.data != null).length,
    },
    "tinder batch-analyze done"
  );

  return NextResponse.json({ results, concurrency });
}
