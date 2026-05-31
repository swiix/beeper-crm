import { NextRequest, NextResponse } from "next/server";
import { getOpenAiUsageSummary } from "@/lib/openai-usage";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const daysRaw = url.searchParams.get("days");
  const days = Math.max(1, Math.min(365, daysRaw ? parseInt(daysRaw, 10) || 30 : 30));
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const summary = getOpenAiUsageSummary({ sinceMs });
  return NextResponse.json({ days, ...summary });
}

