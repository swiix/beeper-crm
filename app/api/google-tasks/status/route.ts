import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getGoogleTasksConnectionStatus } from "@/lib/google-tasks";

const log = createLogger("api:google-tasks:status");

export async function GET() {
  try {
    return NextResponse.json(getGoogleTasksConnectionStatus());
  } catch (e) {
    log.error({ err: e }, "Google Tasks status failed");
    return NextResponse.json({ error: "Failed to read Google Tasks status." }, { status: 500 });
  }
}
