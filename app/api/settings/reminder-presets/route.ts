import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import {
  readReminderPresets,
  writeReminderPresets,
  type ReminderPreset,
  type StoredReminderPresets,
} from "@/lib/reminder-presets-store";

const log = createLogger("api:settings:reminder-presets");

/**
 * GET: return saved reminder presets (for TinderChat etc.). Returns default when not set.
 */
export async function GET() {
  try {
    const stored = readReminderPresets();
    return NextResponse.json(stored);
  } catch (e) {
    log.error({ err: e }, "GET reminder presets failed");
    return NextResponse.json(
      { error: "Failed to read reminder presets" },
      { status: 500 }
    );
  }
}

/**
 * PUT: save reminder presets. Body: { presets: ReminderPreset[] }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const raw = body?.presets;
    if (!Array.isArray(raw)) {
      return NextResponse.json(
        { error: "Body must contain presets array" },
        { status: 400 }
      );
    }
    const presets: ReminderPreset[] = raw
      .filter((p: unknown) => {
        if (!p || typeof p !== "object") return false;
        const x = p as Record<string, unknown>;
        return (
          typeof x.id === "string" &&
          typeof x.label === "string" &&
          (x.type === "hours" || x.type === "days") &&
          typeof x.value === "number" &&
          !Number.isNaN(Number(x.value)) &&
          Number(x.value) >= 0
        );
      })
      .map((p: Record<string, unknown>) => ({
        id: String(p.id).trim(),
        label: String(p.label).trim() || String(p.id),
        type: (p.type as "hours" | "days") ?? "hours",
        value: Math.round(Number(p.value)) || 1,
        time:
          p.time != null && typeof p.time === "string" && /^[0-9]{1,2}:[0-9]{2}$/.test(p.time.trim())
            ? p.time.trim()
            : undefined,
      }))
      .slice(0, 20);
    const stored: StoredReminderPresets = { presets };
    writeReminderPresets(stored);
    log.info({ count: presets.length }, "reminder presets saved");
    return NextResponse.json(stored);
  } catch (e) {
    log.error({ err: e }, "PUT reminder presets failed");
    return NextResponse.json(
      { error: "Failed to save reminder presets" },
      { status: 500 }
    );
  }
}
