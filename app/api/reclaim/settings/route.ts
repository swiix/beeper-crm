import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { verifyReclaimConnection } from "@/lib/reclaim";
import { getReclaimTokenHint, readReclaimSettings, writeReclaimSettings } from "@/lib/reclaim-settings";

const log = createLogger("api:reclaim:settings");

export async function GET() {
  try {
    const settings = readReclaimSettings();
    return NextResponse.json({
      tokenConfigured: !!settings.apiToken,
      tokenHint: getReclaimTokenHint(settings.apiToken),
    });
  } catch (e) {
    log.error({ err: e }, "GET reclaim settings failed");
    return NextResponse.json({ error: "Failed to read Reclaim settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const rawToken = body?.apiToken;
    const clear = body?.clear === true;

    if (clear) {
      writeReclaimSettings({ apiToken: null });
      return NextResponse.json({ tokenConfigured: false, tokenHint: null, connected: false });
    }

    if (typeof rawToken !== "string" || !rawToken.trim()) {
      return NextResponse.json({ error: "apiToken is required" }, { status: 400 });
    }

    const apiToken = rawToken.trim();
    writeReclaimSettings({ apiToken });

    const verified = await verifyReclaimConnection();
    if (!verified.connected) {
      writeReclaimSettings({ apiToken: null });
      return NextResponse.json(
        { error: "Reclaim authentication failed. Check your API token." },
        { status: 400 }
      );
    }

    log.info({ email: verified.email ?? null }, "Reclaim API token saved");
    return NextResponse.json({
      tokenConfigured: true,
      tokenHint: getReclaimTokenHint(apiToken),
      connected: true,
      email: verified.email ?? null,
    });
  } catch (e) {
    log.error({ err: e }, "PUT reclaim settings failed");
    return NextResponse.json({ error: "Failed to save Reclaim settings" }, { status: 500 });
  }
}
