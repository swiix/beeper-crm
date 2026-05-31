import { NextRequest, NextResponse } from "next/server";
import { beeperJson } from "@/lib/beeper";
import { createLogger } from "@/lib/logger";
import { cacheGet, cacheSet } from "@/lib/cache";

const log = createLogger("api:crm:last-activity");
const LAST_ACTIVITY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface MessageItem {
  timestamp?: string;
  isSender?: boolean;
}

interface LastActivityOptions {
  chatIds: string[];
  forceRefresh: boolean;
  source: string;
  requestId: string;
}

type LastActivityResult = Record<
  string,
  { lastFromMe: string | null; lastFromThem: string | null; followUpCount: number }
>;

/**
 * Count consecutive messages from me at the start (newest first). followUpCount = max(0, count - 1).
 */
function getFollowUpCount(items: MessageItem[]): number {
  let i = 0;
  while (i < items.length && items[i].isSender) i++;
  return Math.max(0, i - 1);
}

function normalizeChatIds(chatIdsRaw: string[]): string[] {
  return [...new Set(chatIdsRaw.map((id) => id.trim()).filter(Boolean))];
}

function lastActivityCacheKey(chatId: string): string {
  return `crm:last-activity:${chatId}`;
}

async function computeLastActivity({
  chatIds,
  forceRefresh,
  source,
  requestId,
}: LastActivityOptions): Promise<{ result: LastActivityResult; headers: Record<string, string> }> {
  const startedAt = Date.now();
  if (chatIds.length === 0) {
    return {
      result: {},
      headers: forceRefresh
        ? { "Cache-Control": "no-store, no-cache, must-revalidate", "X-Request-Id": requestId }
        : { "Cache-Control": "private, max-age=604800", "X-Request-Id": requestId },
    };
  }

  log.info(
    {
      requestId,
      source,
      forceRefresh,
      requestedCount: chatIds.length,
      processedCount: chatIds.length,
      sampleChatIds: chatIds.slice(0, 5),
    },
    "last-activity request started"
  );

  const result: LastActivityResult = {};
  const failed: Array<{ chatId: string; message: string }> = [];

  await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        if (!forceRefresh) {
          const cached = cacheGet<{ lastFromMe: string | null; lastFromThem: string | null; followUpCount: number }>(
            lastActivityCacheKey(chatId)
          );
          if (cached) {
            result[chatId] = cached;
            return;
          }
        }
        const data = await beeperJson<{ items?: MessageItem[] }>(
          `/v1/chats/${encodeURIComponent(chatId)}/messages`,
          { cache: "no-store" }
        );
        const items = data?.items ?? [];
        let lastFromMe: string | null = null;
        let lastFromThem: string | null = null;
        for (const msg of items) {
          const ts = msg.timestamp;
          if (!ts) continue;
          if (msg.isSender) {
            if (!lastFromMe || new Date(ts) > new Date(lastFromMe)) lastFromMe = ts;
          } else {
            if (!lastFromThem || new Date(ts) > new Date(lastFromThem)) lastFromThem = ts;
          }
        }
        const followUpCount = getFollowUpCount(items);
        const computed = { lastFromMe, lastFromThem, followUpCount };
        result[chatId] = computed;
        cacheSet(lastActivityCacheKey(chatId), computed, LAST_ACTIVITY_TTL_MS);
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown error";
        failed.push({ chatId, message });
        result[chatId] = { lastFromMe: null, lastFromThem: null, followUpCount: 0 };
      }
    })
  );

  if (failed.length > 0) {
    log.warn(
      {
        requestId,
        source,
        forceRefresh,
        failedCount: failed.length,
        failedChatIds: failed.map((x) => x.chatId),
        failedReasons: failed.slice(0, 10),
      },
      "last-activity fetch had failures"
    );
  }

  const successCount = chatIds.length - failed.length;
  log.info(
    {
      requestId,
      source,
      forceRefresh,
      durationMs: Date.now() - startedAt,
      processedCount: chatIds.length,
      successCount,
      failedCount: failed.length,
    },
    "last-activity request finished"
  );

  return {
    result,
    headers: forceRefresh
      ? { "Cache-Control": "no-store, no-cache, must-revalidate", "X-Request-Id": requestId }
      : { "Cache-Control": "private, max-age=604800", "X-Request-Id": requestId },
  };
}

/**
 * GET /api/crm/last-activity?chatIds=id1,id2,id3
 * Returns per chatId: lastFromMe (ISO), lastFromThem (ISO), followUpCount (number of follow-ups without reply).
 */
export async function GET(request: NextRequest) {
  const chatIdsParam = request.nextUrl.searchParams.get("chatIds");
  if (!chatIdsParam) {
    return NextResponse.json({ error: "Missing chatIds query parameter" }, { status: 400 });
  }
  const chatIds = normalizeChatIds(chatIdsParam.split(","));
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const source = request.nextUrl.searchParams.get("source") ?? "unknown";
  const requestId =
    request.nextUrl.searchParams.get("requestId") ??
    `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { result, headers } = await computeLastActivity({ chatIds, forceRefresh, source, requestId });
  return NextResponse.json(result, { headers });
}

/**
 * POST /api/crm/last-activity
 * Body: { chatIds: string[], refresh?: boolean, source?: string, requestId?: string }
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    chatIds?: unknown;
    refresh?: unknown;
    source?: unknown;
    requestId?: unknown;
  };
  const rawChatIds = Array.isArray(body.chatIds)
    ? body.chatIds.filter((v): v is string => typeof v === "string")
    : [];
  if (rawChatIds.length === 0) {
    return NextResponse.json({ error: "Missing chatIds in request body" }, { status: 400 });
  }
  const chatIds = normalizeChatIds(rawChatIds);
  const forceRefresh = body.refresh === true;
  const source = typeof body.source === "string" && body.source.trim().length > 0 ? body.source : "unknown";
  const requestId =
    typeof body.requestId === "string" && body.requestId.trim().length > 0
      ? body.requestId
      : `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { result, headers } = await computeLastActivity({ chatIds, forceRefresh, source, requestId });
  return NextResponse.json(result, { headers });
}
