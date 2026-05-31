import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { prewarmTranscriptsForChats } from "@/lib/chat-transcribe-prewarm";

const log = createLogger("api:transcribe-chats");

/**
 * POST: prewarm transcript cache for the given chat IDs.
 * Fetches messages per chat and transcribes all audio so that subsequent
 * analyze-chat requests use full content (transcripts first, then analysis).
 * Body: { chatIds: string[] }
 */
export async function POST(request: NextRequest) {
  let body: { chatIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const chatIds = Array.isArray(body.chatIds) ? body.chatIds.filter((id) => typeof id === "string") : [];
  if (chatIds.length === 0) {
    return NextResponse.json({ ok: true, prewarmed: 0 });
  }
  try {
    await prewarmTranscriptsForChats(chatIds);
    log.info({ count: chatIds.length, chatIds: chatIds.slice(0, 5) }, "transcribe-chats prewarm done");
    return NextResponse.json({ ok: true, prewarmed: chatIds.length });
  } catch (e) {
    log.error({ err: e }, "transcribe-chats prewarm failed");
    return NextResponse.json({ error: "Prewarm failed" }, { status: 502 });
  }
}
