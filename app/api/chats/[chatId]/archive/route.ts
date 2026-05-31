import { NextRequest, NextResponse } from "next/server";
import { beeperFetch } from "@/lib/beeper";
import { cacheInvalidatePrefix } from "@/lib/cache";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:chats:archive");

/**
 * POST: archive or unarchive a chat (Beeper API: POST /v1/chats/{chatID}/archive).
 * Body: { archived: boolean }. Returns 204 on success.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    if (!chatId) {
      return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
    }
    let body: { archived?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const archived = body.archived === true;
    const res = await beeperFetch(`/v1/chats/${encodeURIComponent(chatId)}/archive`, {
      method: "POST",
      body: JSON.stringify({ archived }),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ chatId, status: res.status, body: text?.slice(0, 200) }, "archive failed");
      return NextResponse.json(
        { error: text || res.statusText || "Archive failed" },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }
    cacheInvalidatePrefix("chats:");
    log.info({ chatId, archived }, "chat archive updated");
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    log.error({ err: e }, "POST archive failed");
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Archive failed" },
      { status: 502 }
    );
  }
}
