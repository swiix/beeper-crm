import { NextRequest, NextResponse } from "next/server";
import { beeperFetch } from "@/lib/beeper";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:assets:serve");

/**
 * Proxy to Beeper GET /v1/assets/serve?url=...
 * Streams mxc://, localmxc://, or file:// assets so the browser can load them.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Missing url query parameter" }, { status: 400 });
  }

  try {
    const path = `/v1/assets/serve?${new URLSearchParams({ url }).toString()}`;
    const res = await beeperFetch(path, {
      method: "GET",
      headers: {},
    } as RequestInit);

    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, url: url.slice(0, 80) }, "Beeper serve failed");
      return NextResponse.json(
        { error: `Asset serve failed: ${res.status}` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const cacheControl = res.headers.get("cache-control") ?? "private, max-age=3600";

    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    });
  } catch (e) {
    log.error({ err: e, url: url.slice(0, 80) }, "Asset serve error");
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Asset serve failed" },
      { status: 502 }
    );
  }
}
