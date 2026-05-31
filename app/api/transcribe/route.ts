import { NextRequest, NextResponse } from "next/server";
import { getTranscript } from "@/lib/transcribe";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:transcribe");

/**
 * GET: transcribe audio at URL. Query param: url (mxc:// or file:// from Beeper).
 * Returns { text: string } or { error: string }.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Missing url query parameter" }, { status: 400 });
  }
  try {
    const text = await getTranscript(url);
    return NextResponse.json({ text });
  } catch (e) {
    log.error({ err: e }, "GET transcribe failed");
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Transcription failed" },
      { status: 502 }
    );
  }
}

/**
 * POST: same, body { audioUrl: string }. Returns { text: string }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const audioUrl = typeof body?.audioUrl === "string" ? body.audioUrl.trim() : "";
    if (!audioUrl) {
      return NextResponse.json({ error: "Missing audioUrl in body" }, { status: 400 });
    }
    const text = await getTranscript(audioUrl);
    return NextResponse.json({ text });
  } catch (e) {
    log.error({ err: e }, "POST transcribe failed");
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Transcription failed" },
      { status: 502 }
    );
  }
}
