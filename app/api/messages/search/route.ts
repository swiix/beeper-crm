import { NextRequest, NextResponse } from "next/server";
import { beeperJson } from "@/lib/beeper";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:messages:search");

/**
 * GET /api/messages/search
 * Proxies to Beeper GET /v1/messages/search for filtering messages in the chat view.
 * Query params: chatId, accountIDs?, sender?, query?, mediaTypes?, dateAfter?, dateBefore?, limit?, cursor?, direction?
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");
    const accountIDs = searchParams.get("accountIDs");
    const sender = searchParams.get("sender");
    const query = searchParams.get("query");
    const mediaTypes = searchParams.get("mediaTypes");
    const dateAfter = searchParams.get("dateAfter");
    const dateBefore = searchParams.get("dateBefore");
    const limit = searchParams.get("limit");
    const cursor = searchParams.get("cursor");
    const direction = searchParams.get("direction");

    const q = new URLSearchParams();
    if (chatId) q.set("chatIDs", chatId);
    if (accountIDs) q.set("accountIDs", accountIDs);
    if (sender) q.set("sender", sender);
    if (query && query.trim()) q.set("query", query.trim());
    if (mediaTypes) q.set("mediaTypes", mediaTypes);
    if (dateAfter) q.set("dateAfter", dateAfter);
    if (dateBefore) q.set("dateBefore", dateBefore);
    if (limit) q.set("limit", limit);
    if (cursor) q.set("cursor", cursor);
    if (direction) q.set("direction", direction);

    const suffix = q.toString() ? `?${q.toString()}` : "";
    const path = `/v1/messages/search${suffix}`;
    log.debug({ chatId, sender, hasQuery: !!query, hasMedia: !!mediaTypes }, "messages search");
    const data = await beeperJson<unknown>(path);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Message search failed";
    log.error({ err: e }, "messages search failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
