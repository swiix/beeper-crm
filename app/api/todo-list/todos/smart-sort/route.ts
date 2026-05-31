import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { trackOpenAiUsageEvent } from "@/lib/openai-usage";

const log = createLogger("api:todo-list:todos:smart-sort");

type TodoInput = { id: string; title: string; notes?: string | null; due_date?: string | null };

const SMART_SORT_SYSTEM = `You are a task prioritization assistant. You receive a list of todo items and must return their IDs in order of real urgency.

Rules:
- Sort primarily by urgency inferred from the TITLE and NOTES text (e.g. "ASAP", "dringend", "wichtig", "when you have time", "backup", "optional").
- Use deadline (due_date) only as a secondary tiebreaker when text does not indicate urgency.
- Most urgent first. Return a JSON object with a single key "orderedIds": an array of todo id strings in the new order.
- Include every id exactly once. Do not add or remove ids.`;

/**
 * POST /api/todo-list/todos/smart-sort
 * Body: { todos: Array<{ id: string, title: string, notes?: string | null, due_date?: string | null }> }
 * Returns: { orderedIds: string[] } — same ids in urgency order (most urgent first).
 */
export async function POST(request: NextRequest) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY?.trim()) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 502 });
  }

  let body: { todos?: unknown[] };
  try {
    body = (await request.json()) as { todos?: unknown[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = Array.isArray(body.todos) ? body.todos : [];
  const todos: TodoInput[] = raw
    .filter((t): t is Record<string, unknown> => t != null && typeof t === "object")
    .filter((t) => typeof t.id === "string" && typeof t.title === "string")
    .map((t) => ({
      id: String(t.id),
      title: String(t.title),
      notes: typeof t.notes === "string" ? t.notes : null,
      due_date: typeof t.due_date === "string" ? t.due_date : null,
    }));

  if (todos.length === 0) {
    return NextResponse.json({ orderedIds: [] });
  }

  const userPayload = JSON.stringify(
    todos.map((t) => ({
      id: t.id,
      title: t.title,
      ...(t.notes ? { notes: t.notes } : {}),
      ...(t.due_date ? { due_date: t.due_date } : {}),
    })),
    null,
    2
  );

  const userContent = `Sort these todos by real urgency (title/notes first, deadline second). Return JSON: { "orderedIds": ["id1", "id2", ...] } with every id exactly once, most urgent first.\n\n${userPayload}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SMART_SORT_SYSTEM },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    const data = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    if (!res.ok) {
      const err = data?.error?.message ?? res.statusText;
      log.warn({ status: res.status, error: err }, "smart-sort OpenAI error");
      return NextResponse.json({ error: err }, { status: res.status >= 500 ? 502 : 400 });
    }
    trackOpenAiUsageEvent({
      category: "smart_sort",
      model: "gpt-4o-mini",
      usage: data.usage ?? null,
    });

    const rawContent = data?.choices?.[0]?.message?.content;
    if (!rawContent || typeof rawContent !== "string") {
      return NextResponse.json({ error: "Empty OpenAI response" }, { status: 502 });
    }

    let parsed: { orderedIds?: unknown };
    try {
      parsed = JSON.parse(rawContent) as { orderedIds?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid JSON from OpenAI" }, { status: 502 });
    }

    const orderedIds = Array.isArray(parsed.orderedIds)
      ? (parsed.orderedIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];

    const idSet = new Set(todos.map((t) => t.id));
    const validOrdered = orderedIds.filter((id) => idSet.has(id));
    const missing = todos.filter((t) => !validOrdered.includes(t.id)).map((t) => t.id);
    const result = [...validOrdered, ...missing];

    log.info({ count: todos.length, orderedCount: validOrdered.length }, "smart-sort done");
    return NextResponse.json({ orderedIds: result });
  } catch (e) {
    log.error({ err: e }, "smart-sort failed");
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Smart sort failed" },
      { status: 500 }
    );
  }
}
