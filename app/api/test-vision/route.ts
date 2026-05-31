/**
 * POST /api/test-vision
 * Body: { imageUrl: string } — public image URL (e.g. https://...)
 * Fetches the image, runs Vision API with same logic as todo-list image analysis,
 * returns { ok: true, description: string } or { ok: false, error: string }.
 * For local testing only; no auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { analyzeImageDataUrl } from "@/lib/vision";

export async function POST(request: NextRequest) {
  let body: { imageUrl?: string };
  try {
    body = (await request.json()) as { imageUrl?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";
  if (!imageUrl || (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
    return NextResponse.json(
      { ok: false, error: "Body must include imageUrl (public http(s) URL)" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(imageUrl, { method: "GET" });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Failed to fetch image: ${res.status} ${res.statusText}` },
        { status: 400 }
      );
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0) {
      return NextResponse.json({ ok: false, error: "Empty image" }, { status: 400 });
    }
    const contentType = res.headers.get("content-type") ?? "";
    const mime = contentType.toLowerCase().split(";")[0].trim() || "image/jpeg";
    const base64 = Buffer.from(buffer).toString("base64");
    const dataUrl = `data:${mime};base64,${base64}`;

    const description = await analyzeImageDataUrl(dataUrl);
    if (!description) {
      return NextResponse.json({
        ok: false,
        error: "Vision API returned no description (refusal or error)",
      });
    }
    return NextResponse.json({ ok: true, description });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Vision test failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
