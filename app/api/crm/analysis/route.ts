import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getCacheTTLMs } from "@/lib/cache-settings";
import { getAnalysisCacheRow } from "@/lib/analysis-db";
import { beeperJson } from "@/lib/beeper";
import type { ContactAnalysis } from "@/lib/types";

interface BeeperMessagesResponse {
  items?: Array<{ sortKey?: string }>;
}

async function fetchLatestChatMarker(chatId: string): Promise<string | null> {
  const path = `/v1/chats/${encodeURIComponent(chatId)}/messages`;
  const data = await beeperJson<BeeperMessagesResponse>(path);
  return data?.items?.[0]?.sortKey ?? null;
}

function normalizeChatIds(chatIdsRaw: string[]): string[] {
  return [...new Set(chatIdsRaw.map((id) => id.trim()).filter(Boolean))];
}

async function computeCrmAnalysis(chatIds: string[]): Promise<Record<string, ContactAnalysis>> {
  const result: Record<string, ContactAnalysis> = {};
  await Promise.all(
    chatIds.map(async (chatId) => {
      const key = `analysis:${chatId}`;
      let row = cacheGet<ContactAnalysis>(key);
      if (row === undefined) {
        const cacheRow = getAnalysisCacheRow(chatId, false);
        if (cacheRow?.analysis) {
          let isFresh = false;
          try {
            const latestSortKey = await fetchLatestChatMarker(chatId);
            isFresh =
              !!latestSortKey &&
              cacheRow.lastMessageSortKey === latestSortKey;
          } catch {
            // if marker fetch fails, keep previous behavior and allow cached value
            isFresh = true;
          }
          if (isFresh) {
            row = cacheRow.analysis;
          }
        }
        if (row) {
          cacheSet(key, row, getCacheTTLMs("analysis"));
        }
      }
      if (row !== undefined) {
        result[chatId] = row;
      }
    })
  );
  return result;
}

/**
 * GET /api/crm/analysis?chatIds=id1,id2,id3
 * Returns ContactAnalysis per chatId from in-memory cache or SQLite (default view), same as chat analysis hydration.
 */
export async function GET(request: NextRequest) {
  const chatIdsParam = request.nextUrl.searchParams.get("chatIds");
  if (!chatIdsParam) {
    return NextResponse.json({ error: "Missing chatIds query parameter" }, { status: 400 });
  }
  const chatIds = normalizeChatIds(chatIdsParam.split(","));
  const result = await computeCrmAnalysis(chatIds);

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

/**
 * POST /api/crm/analysis
 * Body: { chatIds: string[] }
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { chatIds?: unknown };
  const rawChatIds = Array.isArray(body.chatIds)
    ? body.chatIds.filter((v): v is string => typeof v === "string")
    : [];
  if (rawChatIds.length === 0) {
    return NextResponse.json({ error: "Missing chatIds in request body" }, { status: 400 });
  }
  const chatIds = normalizeChatIds(rawChatIds);
  const result = await computeCrmAnalysis(chatIds);

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}
