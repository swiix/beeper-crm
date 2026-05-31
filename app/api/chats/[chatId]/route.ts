import { NextRequest, NextResponse } from "next/server";
import { beeperJson } from "@/lib/beeper";
import { normalizeChatDetailResponse } from "@/lib/beeper-normalize";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getCacheTTLMs } from "@/lib/cache-settings";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:chat");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    const key = `chat:${chatId}`;
    const cached = cacheGet<unknown>(key);
    if (cached !== undefined) {
      log.debug({ cacheHit: true, chatId }, "GET chat");
      return NextResponse.json(normalizeChatDetailResponse(cached), {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    }
    log.info({ chatId }, "GET chat (cache miss)");
    const raw = await beeperJson<unknown>(`/v1/chats/${encodeURIComponent(chatId)}`);
    const data = normalizeChatDetailResponse(raw);
    cacheSet(key, data, getCacheTTLMs("chatDetail"));
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch chat";
    log.error({ err: e, chatId: (await params).chatId }, "GET chat failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
