import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import {
  addPinnedTodoChatId,
  listPinnedTodoChatIds,
  removePinnedTodoChatId,
  setPinnedTodoChatIds,
} from "@/lib/todo-pinned-chats";

const log = createLogger("api:settings:todo-pinned-chats");

export async function GET() {
  try {
    return NextResponse.json({ chatIds: listPinnedTodoChatIds() });
  } catch (e) {
    log.error({ err: e }, "GET todo-pinned-chats failed");
    return NextResponse.json({ error: "Failed to read pinned chats" }, { status: 500 });
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
    setPinnedTodoChatIds(chatIds);
    return NextResponse.json({ chatIds: listPinnedTodoChatIds() });
  } catch (e) {
    log.error({ err: e }, "PUT todo-pinned-chats failed");
    return NextResponse.json({ error: "Failed to save pinned chats" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const chatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";
    if (!chatId) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }
    addPinnedTodoChatId(chatId);
    return NextResponse.json({ chatIds: listPinnedTodoChatIds() });
  } catch (e) {
    log.error({ err: e }, "POST todo-pinned-chats failed");
    return NextResponse.json({ error: "Failed to pin chat" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const chatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";
    if (!chatId) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }
    removePinnedTodoChatId(chatId);
    return NextResponse.json({ chatIds: listPinnedTodoChatIds() });
  } catch (e) {
    log.error({ err: e }, "DELETE todo-pinned-chats failed");
    return NextResponse.json({ error: "Failed to unpin chat" }, { status: 500 });
  }
}
