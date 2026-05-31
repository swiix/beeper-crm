import { NextRequest, NextResponse } from "next/server";
import { beeperFetch } from "@/lib/beeper";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:focus");

/**
 * POST /api/focus
 * Proxies to Beeper POST /v1/focus to open Beeper Desktop and focus on a chat.
 * Body: { chatID?: string, messageID?: string, draftText?: string }
 */
export async function POST(request: NextRequest) {
  try {
    let body: { chatID?: string; messageID?: string; draftText?: string } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const res = await beeperFetch("/v1/focus", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      log.warn({ status: res.status, chatID: body.chatID }, "focus failed");
      return NextResponse.json(
        { error: (data as { error?: string })?.error || res.statusText },
        { status: res.status }
      );
    }
    log.debug({ chatID: body.chatID }, "focus ok");
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Focus failed";
    log.error({ err: e }, "focus error");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
