import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { buildGoogleOauthUrl } from "@/lib/google-tasks";

const log = createLogger("api:google-tasks:connect");

export async function GET(request: NextRequest) {
  try {
    const url = buildGoogleOauthUrl(request.nextUrl.origin);
    return NextResponse.redirect(url);
  } catch (e) {
    log.error({ err: e }, "Google Tasks connect failed");
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to initialize Google OAuth." }, { status: 500 });
  }
}
