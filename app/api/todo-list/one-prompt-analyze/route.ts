import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { beeperJson } from "@/lib/beeper";
import { normalizePhoneValue } from "@/lib/chat-phone-search";
import { readAnalyzeCostUsd } from "@/lib/openai-cost";

const log = createLogger("api:todo-list:one-prompt-analyze");

type OnePromptTarget = {
  chatId: string;
  chatName?: string | null;
};

type OnePromptResult = {
  chatId: string;
  chatName: string;
  matched: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  phones: string[];
  emails: string[];
  reason: string;
  output: string;
  outputType: "text" | "json";
  todo: {
    title: string;
    notes: string | null;
    due: string | null;
    priority: number | null;
  } | null;
  estimated_cost_usd?: number;
  error?: string;
};

type RawChatParticipant = {
  id?: string;
  phoneNumber?: string;
  handle?: string;
};

type RawChatResponse = {
  participants?: {
    items?: RawChatParticipant[];
  };
};

function parseOutput(notes: string | null): { text: string; type: "text" | "json" } {
  const raw = (notes ?? "").trim();
  if (!raw) return { text: "", type: "text" };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return { text: JSON.stringify(parsed, null, 2), type: "json" };
  } catch {
    return { text: raw, type: "text" };
  }
}

function stripCodeFences(text: string): string {
  return text
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    .trim();
}

function getPhonesFromParticipant(p: RawChatParticipant): string[] {
  const out: string[] = [];
  if (typeof p.phoneNumber === "string") {
    const normalized = normalizePhoneValue(p.phoneNumber);
    if (normalized) out.push(normalized);
  }
  if (typeof p.id === "string") {
    const match = p.id.match(/whatsapp_([0-9]{7,})/i);
    if (match?.[1]) out.push(`+${match[1]}`);
  }
  if (typeof p.handle === "string") {
    const normalized = normalizePhoneValue(p.handle);
    if (normalized) out.push(normalized);
  }
  return out;
}

async function fetchChatPhoneNumbers(chatId: string): Promise<string[]> {
  try {
    const raw = await beeperJson<RawChatResponse>(`/v1/chats/${encodeURIComponent(chatId)}`);
    const participants = raw?.participants?.items ?? [];
    const phones = participants.flatMap(getPhonesFromParticipant);
    return Array.from(new Set(phones));
  } catch {
    return [];
  }
}

function extractContactPresence(text: string): { hasPhone: boolean; hasEmail: boolean; phones: string[]; emails: string[] } {
  const normalized = stripCodeFences(text);
  if (!normalized) return { hasPhone: false, hasEmail: false, phones: [], emails: [] };

  const emailMatches = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const validEmails = Array.from(
    new Set(
      emailMatches
        .map((mail) => mail.trim())
        .filter((mail) => !/nicht\s*angegeben|not\s*provided|n\/a|unbekannt/i.test(mail))
    )
  );

  return { hasEmail: validEmails.length > 0, hasPhone: false, phones: [], emails: validEmails };
}

function isExplicitNoMatch(value: string | null): boolean {
  const raw = (value ?? "").trim();
  if (!raw) return true;
  if (/^(no_match|keine treffer|kein treffer|none|no relevant result|not found)$/i.test(raw)) return true;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    if (obj.matched === false || obj.match === false) return true;
    if (Array.isArray(obj.results) && obj.results.length === 0) return true;
    if (Array.isArray(obj.candidates) && obj.candidates.length === 0) return true;
  } catch {
    // plain text output
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      accountId?: string;
      onePrompt?: string;
      targets?: OnePromptTarget[];
      messageScanMode?: "count" | "age" | "both";
      maxMessages?: number;
      maxMessageAgeDays?: number;
      attachmentMode?: "fast" | "full";
      force?: boolean;
    };

    const onePrompt = typeof body.onePrompt === "string" ? body.onePrompt.trim() : "";
    if (!onePrompt) {
      return NextResponse.json({ error: "Missing onePrompt" }, { status: 400 });
    }
    const targets = Array.isArray(body.targets)
      ? body.targets.filter((t): t is OnePromptTarget => !!t && typeof t.chatId === "string" && t.chatId.trim().length > 0)
      : [];
    if (targets.length === 0) {
      return NextResponse.json({ error: "No chat targets provided" }, { status: 400 });
    }

    const origin = request.nextUrl.origin;
    const results: OnePromptResult[] = [];
    let failed = 0;
    let processed = 0;
    let totalCostUsd = 0;

    await runWithConcurrency(4, targets, async (target) => {
      const chatId = target.chatId.trim();
      const chatName = (target.chatName ?? "").trim() || chatId.slice(0, 8);
      try {
        const beeperPhones = await fetchChatPhoneNumbers(chatId);
        const res = await fetch(`${origin}/api/todo-list/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            chatId,
            accountId: body.accountId,
            contactName: target.chatName ?? undefined,
            onePrompt,
            messageScanMode: body.messageScanMode,
            maxMessages: body.maxMessages,
            maxMessageAgeDays: body.maxMessageAgeDays,
            attachmentMode: body.attachmentMode,
            force: body.force ?? true,
            stream: false,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          todos?: Array<{ title?: string; notes?: string | null; due?: string | null; priority?: number | string | null }>;
          error?: string;
          estimated_cost_usd?: number;
        };
        const chatCostUsd = readAnalyzeCostUsd(data);
        totalCostUsd += chatCostUsd;
        if (!res.ok) {
          failed += 1;
          results.push({
            chatId,
            chatName,
            matched: false,
            hasPhone: false,
            hasEmail: false,
            phones: [],
            emails: [],
            reason: "Analyse-Fehler",
            output: "",
            outputType: "text",
            todo: null,
            estimated_cost_usd: chatCostUsd,
            error: data.error ?? "Analyse fehlgeschlagen",
          });
          return;
        }
        const todos = Array.isArray(data.todos) ? data.todos : [];
        const first = todos[0];
        if (!first || isExplicitNoMatch(typeof first.notes === "string" ? first.notes : null)) {
          results.push({
            chatId,
            chatName,
            matched: false,
            hasPhone: beeperPhones.length > 0,
            hasEmail: false,
            phones: beeperPhones,
            emails: [],
            reason: "Kein Treffer laut Prompt-Antwort",
            output: "",
            outputType: "text",
            todo: null,
            estimated_cost_usd: chatCostUsd,
          });
          return;
        }
        const parsed = parseOutput(typeof first.notes === "string" ? first.notes : null);
        const cleanedOutput = stripCodeFences(parsed.text);
        const presence = extractContactPresence(cleanedOutput);
        const hasPhoneFromBeeper = beeperPhones.length > 0;
        const matched = hasPhoneFromBeeper && presence.hasEmail;
        if (!matched) {
          const missing = !hasPhoneFromBeeper && !presence.hasEmail ? "Telefonnummer (Beeper) und E-Mail fehlen"
            : !hasPhoneFromBeeper ? "Telefonnummer (Beeper) fehlt"
            : "E-Mail fehlt";
          results.push({
            chatId,
            chatName,
            matched: false,
            hasPhone: hasPhoneFromBeeper,
            hasEmail: presence.hasEmail,
            phones: beeperPhones,
            emails: presence.emails,
            reason: missing,
            output: "",
            outputType: parsed.type,
            todo: null,
            estimated_cost_usd: chatCostUsd,
          });
          return;
        }
        const numericPriority =
          typeof first.priority === "number" && Number.isFinite(first.priority)
            ? Math.max(1, Math.min(5, Math.round(first.priority)))
            : null;
        results.push({
          chatId,
          chatName,
          matched,
          hasPhone: hasPhoneFromBeeper,
          hasEmail: presence.hasEmail,
          phones: beeperPhones,
          emails: presence.emails,
          reason: "Telefon (Beeper) und E-Mail gefunden",
          output: cleanedOutput,
          outputType: parsed.type,
          todo: {
            title: typeof first.title === "string" && first.title.trim() ? first.title.trim() : "One-Prompt Ergebnis",
            notes: cleanedOutput,
            due: typeof first.due === "string" ? first.due : null,
            priority: numericPriority,
          },
          estimated_cost_usd: chatCostUsd,
        });
      } catch (error) {
        failed += 1;
        results.push({
          chatId,
          chatName,
          matched: false,
          hasPhone: false,
          hasEmail: false,
          phones: [],
          emails: [],
          reason: "Analyse-Exception",
          output: "",
          outputType: "text",
          todo: null,
          error: error instanceof Error ? error.message : "Analyse fehlgeschlagen",
        });
      } finally {
        processed += 1;
      }
    });

    return NextResponse.json({
      results,
      matchedResults: results.filter((r) => r.matched),
      unmatchedResults: results.filter((r) => !r.matched),
      summary: {
        processed,
        matched: results.filter((r) => r.matched).length,
        unmatched: results.filter((r) => !r.matched).length,
        failed,
        total_cost_usd: Number(totalCostUsd.toFixed(6)),
      },
    });
  } catch (error) {
    log.error({ err: error }, "one-prompt analyze failed");
    return NextResponse.json({ error: "One-prompt analysis failed" }, { status: 500 });
  }
}
