import { NextRequest, NextResponse } from "next/server";
import { beeperFetch } from "@/lib/beeper";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:chats:reminders");

/** Legacy preset: 1h, tomorrow, 7d (backward compat). */
function remindAtMsFromLegacyPreset(preset: string): number {
  const now = Date.now();
  switch (preset) {
    case "tomorrow": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(6, 0, 0, 0);
      return d.getTime();
    }
    case "7d": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + 7);
      d.setUTCHours(6, 0, 0, 0);
      return d.getTime();
    }
    default:
      return now + 60 * 60 * 1000;
  }
}

/** Compute remindAtMs from configurable preset: hours offset, or days + optional time "HH:mm" (UTC). */
function remindAtMsFromConfig(
  type: "hours" | "days",
  value: number,
  time?: string
): number {
  const now = Date.now();
  if (type === "hours") {
    const hours = Math.max(0, Math.min(720, Math.round(value)));
    return now + hours * 60 * 60 * 1000;
  }
  const days = Math.max(0, Math.min(365, Math.round(value)));
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  if (time && /^([0-9]{1,2}):([0-9]{2})$/.test(time.trim())) {
    const [, h, m] = time.trim().match(/^([0-9]{1,2}):([0-9]{2})$/)!;
    d.setUTCHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
  }
  return d.getTime();
}

/**
 * POST: set a reminder for the chat (Beeper API: POST /v1/chats/{chatID}/reminders).
 * Body: { preset?: "1h"|"tomorrow"|"7d" } for legacy, or { type: "hours"|"days", value: number, time?: "HH:mm" } for configurable.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    if (!chatId) {
      return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
    }
    let body: {
      preset?: string;
      type?: "hours" | "days";
      value?: number;
      time?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    let remindAtMs: number;
    if (
      body.type === "hours" ||
      body.type === "days"
    ) {
      const value = typeof body.value === "number" && !Number.isNaN(body.value) ? body.value : 1;
      remindAtMs = remindAtMsFromConfig(body.type, value, body.time);
    } else if (body.preset === "tomorrow" || body.preset === "7d") {
      remindAtMs = remindAtMsFromLegacyPreset(body.preset);
    } else {
      remindAtMs = remindAtMsFromLegacyPreset("1h");
    }

    const res = await beeperFetch(`/v1/chats/${encodeURIComponent(chatId)}/reminders`, {
      method: "POST",
      body: JSON.stringify({
        reminder: { remindAtMs, dismissOnIncomingMessage: true },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn({ chatId, status: res.status }, "reminder failed");
      return NextResponse.json(
        { error: text || res.statusText || "Reminder failed" },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }
    log.info({ chatId }, "reminder set");
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    log.error({ err: e }, "POST reminder failed");
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Reminder failed" },
      { status: 502 }
    );
  }
}

/**
 * DELETE: clear reminder for the chat (Beeper API: DELETE /v1/chats/{chatID}/reminders).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    if (!chatId) {
      return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
    }
    const res = await beeperFetch(`/v1/chats/${encodeURIComponent(chatId)}/reminders`, {
      method: "DELETE",
    });
    if (!res.ok) {
      log.warn({ chatId, status: res.status }, "reminder delete failed");
      return NextResponse.json(
        { error: res.statusText || "Delete reminder failed" },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }
    log.info({ chatId }, "reminder cleared");
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    log.error({ err: e }, "DELETE reminder failed");
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 502 }
    );
  }
}
