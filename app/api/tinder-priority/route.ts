import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getPriorities } from "@/lib/tinder-priority-store";

const log = createLogger("api:tinder-priority");

/**
 * GET: return stored priorityIndex (1–10) for given chat IDs.
 * Query: chatIds=id1,id2,... (comma-separated)
 */
export async function GET(request: NextRequest) {
  try {
    const chatIdsParam = request.nextUrl.searchParams.get("chatIds");
    const chatIds =
      typeof chatIdsParam === "string" && chatIdsParam.trim()
        ? chatIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    const priorities = getPriorities(chatIds);
    return NextResponse.json({ priorities });
  } catch (e) {
    log.error({ err: e }, "GET tinder-priority failed");
    return NextResponse.json({ error: "Failed to read priorities" }, { status: 500 });
  }
}
