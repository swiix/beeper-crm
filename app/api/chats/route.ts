import { NextRequest, NextResponse } from "next/server";
import { beeperJson } from "@/lib/beeper";
import { normalizeChatsResponse } from "@/lib/beeper-normalize";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getCacheTTLMs } from "@/lib/cache-settings";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:chats");

function chatsCacheKey(accountIDs: string | null, cursor: string | null, direction: string | null): string {
  const a = accountIDs ?? "";
  const c = cursor ?? "";
  const d = direction ?? "";
  return `chats:${a}:${c}:${d}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountIDs = searchParams.get("accountIDs");
    const cursor = searchParams.get("cursor");
    const direction = searchParams.get("direction");
    const key = chatsCacheKey(accountIDs, cursor, direction);
    const cached = cacheGet<unknown>(key);
    if (cached !== undefined) {
      log.debug({ cacheHit: true, accountIDs }, "GET chats");
      return NextResponse.json(normalizeChatsResponse(cached), {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
    log.info({ accountIDs }, "GET chats (cache miss)");
    const params = new URLSearchParams();
    if (accountIDs) params.set("accountIDs", accountIDs);
    if (cursor) params.set("cursor", cursor);
    if (direction) params.set("direction", direction);
    const q = params.toString();
    const path = q ? `/v1/chats?${q}` : "/v1/chats";
    const raw = await beeperJson<unknown>(path);
    const data = normalizeChatsResponse(raw);
    cacheSet(key, data, getCacheTTLMs("chats"));
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chats konnten nicht geladen werden. Beeper-API prüfen.";
    log.error({ err: e }, "GET chats failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
