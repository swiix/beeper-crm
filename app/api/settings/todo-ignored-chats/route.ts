import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { listIgnoredTodoChatIds, setIgnoredTodoChatIds } from "@/lib/todo-ignored-chats";

const log = createLogger("api:settings:todo-ignored-chats");

export async function GET() {
  try {
    return NextResponse.json({ chatIds: listIgnoredTodoChatIds() });
  } catch (e) {
    log.error({ err: e }, "GET todo-ignored-chats failed");
    return NextResponse.json({ error: "Failed to read ignored chats" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const raw = body?.chatIds;
    if (!Array.isArray(raw)) {
      return NextResponse.json({ error: "chatIds array is required" }, { status: 400 });
    }
    const chatIds = raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    setIgnoredTodoChatIds(chatIds);
    return NextResponse.json({ chatIds: listIgnoredTodoChatIds() });
  } catch (e) {
    log.error({ err: e }, "PUT todo-ignored-chats failed");
    return NextResponse.json({ error: "Failed to save ignored chats" }, { status: 500 });
  }
}
