import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import {
  readCacheSettings,
  writeCacheSettings,
  type CacheTTLSettings,
} from "@/lib/cache-settings";

const log = createLogger("api:settings:cache");

/**
 * GET: return cache TTL settings (all values in minutes).
 */
export async function GET() {
  try {
    const settings = readCacheSettings();
    return NextResponse.json(settings);
  } catch (e) {
    log.error({ err: e }, "GET cache settings failed");
    return NextResponse.json(
      { error: "Failed to read cache settings" },
      { status: 500 }
    );
  }
}

/**
 * PUT: save cache TTL settings. Body: partial CacheTTLSettings (numbers = minutes).
 */
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const current = readCacheSettings();
    const next: CacheTTLSettings = {
      accounts: typeof body?.accounts === "number" ? body.accounts : current.accounts,
      chats: typeof body?.chats === "number" ? body.chats : current.chats,
      chatDetail: typeof body?.chatDetail === "number" ? body.chatDetail : current.chatDetail,
      analysis: typeof body?.analysis === "number" ? body.analysis : current.analysis,
      transcript: typeof body?.transcript === "number" ? body.transcript : current.transcript,
    };
    writeCacheSettings(next);
    log.info("cache settings saved");
    return NextResponse.json(next);
  } catch (e) {
    log.error({ err: e }, "PUT cache settings failed");
    return NextResponse.json(
      { error: "Failed to save cache settings" },
      { status: 500 }
    );
  }
}
