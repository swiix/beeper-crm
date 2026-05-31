import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getReclaimConnectionStatus, verifyReclaimConnection } from "@/lib/reclaim";
import { getReclaimTokenHint, readReclaimSettings } from "@/lib/reclaim-settings";

const log = createLogger("api:reclaim:status");

export async function GET() {
  try {
    const local = getReclaimConnectionStatus();
    if (!local.connected) {
      return NextResponse.json({ connected: false, tokenConfigured: false });
    }

    const verified = await verifyReclaimConnection();
    const settings = readReclaimSettings();
    return NextResponse.json({
      connected: verified.connected,
      tokenConfigured: true,
      tokenHint: getReclaimTokenHint(settings.apiToken),
      email: verified.email ?? null,
    });
  } catch (e) {
    log.error({ err: e }, "GET reclaim status failed");
    return NextResponse.json({ error: "Failed to read Reclaim status" }, { status: 500 });
  }
}
