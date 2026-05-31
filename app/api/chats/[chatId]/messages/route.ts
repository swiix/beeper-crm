import { NextRequest, NextResponse } from "next/server";
import { beeperJson, beeperFetch } from "@/lib/beeper";
import { cacheInvalidatePrefix } from "@/lib/cache";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:messages");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor");
    const direction = searchParams.get("direction");
    log.info({ chatId, cursor: !!cursor }, "GET messages (no cache)");
    const q = new URLSearchParams();
    if (cursor) q.set("cursor", cursor);
    if (direction) q.set("direction", direction);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    const data = await beeperJson<unknown>(
      `/v1/chats/${encodeURIComponent(chatId)}/messages${suffix}`
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch messages";
    log.error({ err: e }, "GET messages failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    const body = await request.json();
    log.info({ chatId, hasText: !!(body as { text?: string })?.text }, "POST message");
    const res = await beeperFetch(
      `/v1/chats/${encodeURIComponent(chatId)}/messages`,
      { method: "POST", body: JSON.stringify(body) }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      log.warn({ chatId, status: res.status }, "POST message rejected");
      return NextResponse.json(
        { error: (data as { error?: string })?.error || res.statusText },
        { status: res.status }
      );
    }
    cacheInvalidatePrefix("chats:");
    cacheInvalidatePrefix(`crm:last-activity:${chatId}`);
    log.debug({ chatId }, "cache invalidated for chats and last-activity");
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send message";
    log.error({ err: e, chatId: (await params).chatId }, "POST message failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
