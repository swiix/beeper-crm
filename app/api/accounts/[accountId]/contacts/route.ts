import { NextRequest, NextResponse } from "next/server";
import { beeperJson } from "@/lib/beeper";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:contacts");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await params;
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") || "";
    log.info({ accountId, query: query || "(all)" }, "GET contacts");
    const path = query
      ? `/v1/accounts/${encodeURIComponent(accountId)}/contacts?query=${encodeURIComponent(query)}`
      : `/v1/accounts/${encodeURIComponent(accountId)}/contacts`;
    const data = await beeperJson<unknown>(path);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch contacts";
    log.error({ err: e, accountId: (await params).accountId }, "GET contacts failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
