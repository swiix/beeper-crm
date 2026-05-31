import { NextRequest, NextResponse } from "next/server";
import { cacheDelete, cacheInvalidatePrefix } from "@/lib/cache";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:settings:cache:clear");

const VALID_TYPES = ["accounts", "chats", "chatDetail", "analysis", "transcript"] as const;

/**
 * POST: clear cache by type. Body: { type: "accounts" | "chats" | "chatDetail" | "analysis" | "transcript" }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const type = body?.type;
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    switch (type) {
      case "accounts":
        cacheDelete("accounts");
        break;
      case "chats":
        cacheInvalidatePrefix("chats:");
        break;
      case "chatDetail":
        cacheInvalidatePrefix("chat:");
        break;
      case "analysis":
        cacheInvalidatePrefix("analysis:");
        break;
      case "transcript":
        cacheInvalidatePrefix("transcript:");
        break;
    }
    log.info({ type }, "cache cleared");
    return NextResponse.json({ ok: true, type });
  } catch (e) {
    log.error({ err: e }, "POST cache clear failed");
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to clear cache" },
      { status: 500 }
    );
  }
}
