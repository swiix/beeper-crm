import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { readRules, writeRules, type StoredRules } from "@/lib/rules-store";

const log = createLogger("api:settings:rules");

/**
 * GET: return saved rules (maxFollowUpsBeforeLost etc.). Returns default when not set.
 */
export async function GET() {
  try {
    const rules = readRules();
    return NextResponse.json(rules);
  } catch (e) {
    log.error({ err: e }, "GET rules failed");
    return NextResponse.json({ error: "Failed to read rules" }, { status: 500 });
  }
}

/**
 * PUT: save rules. Body: { maxFollowUpsBeforeLost?: number, autoLeadKeywords?: string, autoQualifiedKeywords?: string, autoLeadMessageKeywords?: string, analysisConcurrency?: number }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const current = readRules();
    const rawConcurrency = body?.analysisConcurrency;
    const analysisConcurrency =
      typeof rawConcurrency === "number" && rawConcurrency >= 1
        ? Math.min(50, Math.round(rawConcurrency))
        : current.analysisConcurrency;
    const next: StoredRules = {
      maxFollowUpsBeforeLost:
        typeof body?.maxFollowUpsBeforeLost === "number" && body.maxFollowUpsBeforeLost >= 0
          ? Math.round(body.maxFollowUpsBeforeLost)
          : current.maxFollowUpsBeforeLost,
      autoLeadKeywords: typeof body?.autoLeadKeywords === "string" ? body.autoLeadKeywords : current.autoLeadKeywords,
      autoQualifiedKeywords:
        typeof body?.autoQualifiedKeywords === "string" ? body.autoQualifiedKeywords : current.autoQualifiedKeywords,
      autoLeadMessageKeywords:
        typeof body?.autoLeadMessageKeywords === "string" ? body.autoLeadMessageKeywords : current.autoLeadMessageKeywords,
      analysisConcurrency,
    };
    writeRules(next);
    log.info(
      {
        maxFollowUpsBeforeLost: next.maxFollowUpsBeforeLost,
        autoLeadKeywords: !!next.autoLeadKeywords,
        autoQualifiedKeywords: !!next.autoQualifiedKeywords,
        autoLeadMessageKeywords: !!next.autoLeadMessageKeywords,
        analysisConcurrency: next.analysisConcurrency,
      },
      "rules saved"
    );
    return NextResponse.json(next);
  } catch (e) {
    log.error({ err: e }, "PUT rules failed");
    return NextResponse.json({ error: "Failed to save rules" }, { status: 500 });
  }
}
