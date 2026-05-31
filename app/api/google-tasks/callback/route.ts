import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { consumeOauthState, exchangeCodeForTokens } from "@/lib/google-tasks";

const log = createLogger("api:google-tasks:callback");

export async function GET(request: NextRequest) {
  const appRedirect = new URL("/", request.nextUrl.origin);
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const oauthError = request.nextUrl.searchParams.get("error");
    if (oauthError) {
      appRedirect.searchParams.set("googleTasksConnected", "0");
      appRedirect.searchParams.set("googleTasksError", oauthError);
      return NextResponse.redirect(appRedirect);
    }
    if (!code || !state || !consumeOauthState(state)) {
      appRedirect.searchParams.set("googleTasksConnected", "0");
      appRedirect.searchParams.set("googleTasksError", "invalid_state");
      return NextResponse.redirect(appRedirect);
    }

    await exchangeCodeForTokens(code, request.nextUrl.origin);
    appRedirect.searchParams.set("googleTasksConnected", "1");
    return NextResponse.redirect(appRedirect);
  } catch (e) {
    log.error({ err: e }, "Google Tasks callback failed");
    appRedirect.searchParams.set("googleTasksConnected", "0");
    appRedirect.searchParams.set("googleTasksError", "oauth_failed");
    return NextResponse.redirect(appRedirect);
  }
}
