import { NextResponse } from "next/server";
import { beeperJson } from "@/lib/beeper";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getCacheTTLMs } from "@/lib/cache-settings";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:accounts");
const CACHE_KEY_ACCOUNTS = "accounts";

export async function GET() {
  try {
    const cached = cacheGet<unknown>(CACHE_KEY_ACCOUNTS);
    if (cached !== undefined) {
      log.debug({ cacheHit: true }, "GET accounts");
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, max-age=60" },
      });
    }
    log.info("GET accounts (cache miss)");
    const data = await beeperJson<unknown>("/v1/accounts");
    cacheSet(CACHE_KEY_ACCOUNTS, data, getCacheTTLMs("accounts"));
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Accounts konnten nicht geladen werden. Beeper-API prüfen.";
    log.error({ err: e }, "GET accounts failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
