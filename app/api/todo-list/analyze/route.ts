/**
 * POST /api/todo-list/analyze
 * Body: { chatId: string, accountId?: string, contactName?: string }
 * Returns: { todos: TodoSuggestionItem[], last_message_date: string, estimated_total_hours: number }
 * Runs cached or delta analysis depending on chat marker + request options.
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { readTodoSettings } from "@/lib/todo-settings";
import { MAX_CHAT_MESSAGES } from "@/lib/chat-message-limits";
import type { TodoSuggestionItem } from "@/lib/todo-db";
import { getTodoSuggestions, setTodoSuggestions } from "@/lib/todo-db";
import { trackOpenAiUsageEvent } from "@/lib/openai-usage";
import { buildAnalyzeUsageCostMeta, zeroAnalyzeUsageCostMeta } from "@/lib/openai-cost";
import { getTranscript } from "@/lib/transcribe";
import { getImageDescription } from "@/lib/vision";
import { logTodoListAnalysisError } from "@/lib/todo-list-analysis-error-log";
import { logTodoListAnalysisPrompt } from "@/lib/todo-list-analysis-prompt-log";
import {
  appendTodoAnalysisTrace,
  sanitizeTodoAnalyzeClientBody,
  summarizeOpenAiChatPayload,
  summarizeOpenAiResponseBody,
  todoAnalysisBeeperJson,
} from "@/lib/todo-list-analysis-trace-log";
import { computeTodoAnalysisPromptHash } from "@/lib/todo-prompt-hash";
import {
  fetchLastChatMessages,
  fetchLatestChatMarker as fetchLatestMarkerShared,
  isAudioAttachment,
  type BeeperMessagesResponse,
} from "@/lib/beeper-chat-messages";

const log = createLogger("api:todo-list:analyze");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface MessageAttachment {
  type?: string;
  srcURL?: string;
  id?: string;
}

interface MessageItem {
  text?: string;
  senderName?: string;
  isSender?: boolean;
  timestamp?: string;
  sortKey?: string;
  attachments?: MessageAttachment[];
}

function isImageAttachment(a: MessageAttachment): boolean {
  const t = (a.type ?? "").toLowerCase();
  return t === "img" || t === "image" || t === "sticker" || t === "gif";
}

interface FetchMessagesOptions {
  maxCount: number | null;
  minTimestampMs: number | null;
  onPage?: (page: number) => void;
}

interface TranscriptBuildOptions {
  contactName?: string;
  processAttachments: boolean;
}

interface ChatMarker {
  sortKey: string | null;
  timestamp: string | null;
}

/** Fetch recent messages for a chat (chronological, oldest first) with optional count/age limits. */
async function fetchLastMessages(
  chatId: string,
  options: FetchMessagesOptions
): Promise<MessageItem[]> {
  const { maxCount, minTimestampMs, onPage } = options;
  const HARD_FETCH_CAP = 4000;
  return fetchLastChatMessages<MessageItem, MessageItem>(
    chatId,
    {
      limit: maxCount,
      minTimestampMs,
      hardFetchCap: HARD_FETCH_CAP,
      onPage,
      fetchPage: (path, page) =>
        todoAnalysisBeeperJson<BeeperMessagesResponse<MessageItem>>(path, {
          chatId,
          phase: "beeper_messages",
          page,
        }),
    },
    (m) => ({
      text: m.text,
      senderName: m.senderName,
      isSender: m.isSender,
      timestamp: m.timestamp,
      sortKey: m.sortKey,
      attachments: m.attachments,
    })
  );
}

/** Ensure todo title starts with contact first name prefix when contactName is provided. */
function ensureTitlePrefix(title: string, contactName: string | null): string {
  if (!contactName) return title;
  const firstName = contactName.trim().split(/\s+/)[0] || contactName.trim();
  if (!firstName) return title;
  if (/^[^:]+:\s/.test(title)) return title;
  return `${firstName}: ${title}`;
}

function normalizeAiTodos(
  rawTodos: unknown[],
  contactName: string | null,
  defaultDueStr: string,
  defaultDurationHours: number
): TodoSuggestionItem[] {
  const estimateByHeuristicHours = (title: string, notes: string | null): number | null => {
    const t = `${title} ${notes ?? ""}`.toLowerCase();
    if (!t.trim()) return null;
    if (/(kurz|quick|anruf|rückruf|rueckruf|nachricht|antwort|reply|mail|e-?mail)/.test(t)) return 0.25;
    if (/(angebot|proposal|entwurf|dokument|konzept|zusammenfassung|follow-?up)/.test(t)) return 0.75;
    if (/(meeting|termin|call|besprechung|präsentation|praesentation|workshop)/.test(t)) return 1;
    if (/(recherche|analyse|planung|strategie|implementierung|umsetzung|migration|refactor)/.test(t)) return 1.5;
    return null;
  };
  return rawTodos
    .filter((t): t is Record<string, unknown> => t != null && typeof t === "object")
    .map((t) => {
      let title = typeof t.title === "string" && t.title.trim() ? t.title.trim() : "Todo";
      title = ensureTitlePrefix(title, contactName);
      let due: string | null = null;
      if (typeof t.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due)) due = t.due;
      if (due === null) due = defaultDueStr;
      const rawPriority = t.priority;
      const priority: number | string = typeof rawPriority === "number" || typeof rawPriority === "string" ? rawPriority : 3;
      const rawEstHours =
        t.estimated_time_hours ??
        t.estimated_hours ??
        t.estimated_minutes ??
        t.estimated_time ??
        t.duration_minutes ??
        t.duration;
      let estimated_time_hours: number | null =
        typeof rawEstHours === "number" && Number.isFinite(rawEstHours) && rawEstHours >= 0
          ? Number(rawEstHours.toFixed(2))
          : null;
      if (estimated_time_hours == null && typeof rawEstHours === "string") {
        const parsed = Number(rawEstHours.replace(",", ".").replace(/[^\d.]/g, ""));
        if (!Number.isNaN(parsed) && parsed >= 0) estimated_time_hours = Number(parsed.toFixed(2));
      }
      if (estimated_time_hours == null) {
        estimated_time_hours = estimateByHeuristicHours(
          title,
          typeof t.notes === "string" ? t.notes : null
        );
      }
      if (estimated_time_hours == null) {
        estimated_time_hours = defaultDurationHours;
      }
      const estimated_time_minutes: number | null =
        estimated_time_hours != null ? Math.max(0, Math.round(estimated_time_hours * 60)) : null;
      return {
        title,
        due,
        priority,
        notes: typeof t.notes === "string" ? t.notes : null,
        category: typeof t.category === "string" ? t.category : null,
        estimated_time_minutes,
        estimated_time_hours,
      };
    })
    .filter((t) => t.title.length > 0);
}

function getEstimatedTotalHours(todos: TodoSuggestionItem[]): number {
  const hours = todos.reduce((sum, t) => {
    if (typeof t.estimated_time_hours === "number" && Number.isFinite(t.estimated_time_hours) && t.estimated_time_hours > 0) {
      return sum + t.estimated_time_hours;
    }
    const minutes = typeof t.estimated_time_minutes === "number" ? t.estimated_time_minutes : 0;
    return sum + (Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : 0);
  }, 0);
  return Number(hours.toFixed(2));
}

function parseOpenAiOutputToTodos(
  raw: string,
  contactName: string | null,
  defaultDueStr: string,
  defaultDurationHours: number,
  onePromptMode: boolean
): TodoSuggestionItem[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeAiTodos(parsed, contactName, defaultDueStr, defaultDurationHours);
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.todos)) {
        return normalizeAiTodos(obj.todos, contactName, defaultDueStr, defaultDurationHours);
      }
      if (onePromptMode) {
        const asText = JSON.stringify(obj, null, 2).trim();
        if (!asText) return [];
        const defaultMinutes = Math.max(1, Math.round(defaultDurationHours * 60));
        return [
          {
            title: ensureTitlePrefix("One-Prompt Ergebnis", contactName),
            due: defaultDueStr,
            priority: 3,
            notes: asText,
            category: null,
            estimated_time_minutes: defaultMinutes,
            estimated_time_hours: defaultDurationHours,
          },
        ];
      }
    }
  } catch {
    // Non-JSON output is allowed in one-prompt mode.
  }

  if (!onePromptMode) {
    throw new Error("Invalid JSON from OpenAI");
  }

  if (/^(keine|nichts|none|no relevant|leer|not found)/i.test(trimmed)) return [];
  return [
    {
      title: ensureTitlePrefix("One-Prompt Ergebnis", contactName),
      due: defaultDueStr,
      priority: 3,
      notes: trimmed,
      category: null,
      estimated_time_minutes: null,
      estimated_time_hours: null,
    },
  ];
}

/** Format timestamp to YYYY-MM-DD for cache key and last_message_date. */
function toDateOnly(isoOrNull: string | undefined): string | null {
  if (!isoOrNull || typeof isoOrNull !== "string") return null;
  try {
    const d = new Date(isoOrNull);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

async function fetchLatestChatMarker(chatId: string): Promise<ChatMarker> {
  const marker = await fetchLatestMarkerShared<MessageItem>(chatId, (path) =>
    todoAnalysisBeeperJson<BeeperMessagesResponse<MessageItem>>(path, {
      chatId,
      phase: "beeper_chat_marker",
    })
  );
  return { sortKey: marker.sortKey, timestamp: marker.timestamp };
}

function selectMessagesForDelta(messages: MessageItem[], lastAnalyzedSortKey: string | null): MessageItem[] {
  if (!lastAnalyzedSortKey) return messages;
  const idx = messages.findIndex((m) => m.sortKey === lastAnalyzedSortKey);
  if (idx < 0) return messages;
  return messages.slice(idx + 1);
}

function isLowSignalText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (/^[+\-_*~.`\s\d]+$/.test(t)) return true;
  if (/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]+$/u.test(t)) return true;
  return /^(ok|okay|k|kk|thx|thanks|danke|bitte|passt|top|super|perfekt|klar|alles klar|ja|nein|jup|jo|gut|fine|done|erledigt|👍|👌|🙏|✅|❌|🙂|😅|😂|🔥)[.!?]*$/.test(
    t
  );
}

function trimLongText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  const tail = Math.floor(maxChars * 0.25);
  return `${text.slice(0, head)}\n[…gekürzt…]\n${text.slice(-tail)}`;
}

function hasAttachmentTriggerText(text: string): boolean {
  return /(siehe bild|siehe screenshot|screenshot|screen|anbei|anhang|im anhang|rechnung|beleg|foto|bild|sprachnachricht|voice|audio|hör dir|anhören)/i.test(
    text
  );
}

function shouldProcessAttachments(
  messages: MessageItem[],
  index: number,
  attachmentCount: number,
  textPart: string,
  processAttachments: boolean
): boolean {
  if (!processAttachments || attachmentCount === 0) return false;
  if (textPart.length < 10) return true;
  const prevText = index > 0 ? (messages[index - 1]?.text ?? "") : "";
  const nextText = index + 1 < messages.length ? (messages[index + 1]?.text ?? "") : "";
  const combined = `${prevText}\n${textPart}\n${nextText}`;
  return hasAttachmentTriggerText(combined);
}

/** Build transcript with date per message, transcribed voice messages and image descriptions for the AI. */
async function buildTranscriptWithDatesAndTranscription(
  messages: MessageItem[],
  options: TranscriptBuildOptions
): Promise<string> {
  const lines: string[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    const who = m.isSender ? "Ich" : (m.senderName ?? options.contactName ?? "Gegenüber");
    const textPartRaw = (m.text ?? "").trim();
    const textPart = trimLongText(textPartRaw, 1200);
    const audioAttachments = (m.attachments ?? []).filter(isAudioAttachment);
    const imageAttachments = (m.attachments ?? []).filter(isImageAttachment);
    const processAttachmentsForMessage = shouldProcessAttachments(
      messages,
      i,
      audioAttachments.length + imageAttachments.length,
      textPartRaw,
      options.processAttachments
    );
    const transcripts: string[] = [];
    if (processAttachmentsForMessage) {
      for (const att of audioAttachments) {
        const audioUrl = att.srcURL ?? att.id ?? "";
        if (audioUrl) {
          const t = await getTranscript(audioUrl);
          if (t) transcripts.push(trimLongText(t, 700));
        }
      }
      const imageDescriptions: string[] = [];
      for (const att of imageAttachments) {
        const imageUrl = att.srcURL ?? att.id ?? "";
        if (imageUrl) {
          const desc = await getImageDescription(imageUrl);
          if (desc) imageDescriptions.push(trimLongText(desc, 500));
        }
      }
      const audioPart =
        transcripts.length > 0 ? `[Sprachnachricht]: ${transcripts.join(" ")}` : "";
      const imagePart =
        imageDescriptions.length > 0 ? `[Bild]: ${imageDescriptions.join(" ")}` : "";
      const combined = [textPart, audioPart, imagePart].filter(Boolean).join(" ");
      if (!combined) continue;
      let prefix = "[—]";
      if (m.timestamp) {
        try {
          const d = new Date(m.timestamp);
          if (!Number.isNaN(d.getTime())) {
            const y = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            const h = String(d.getHours()).padStart(2, "0");
            const min = String(d.getMinutes()).padStart(2, "0");
            prefix = `[${y}-${mo}-${day} ${h}:${min}]`;
          }
        } catch {
          // keep [—]
        }
      }
      lines.push(`${prefix} ${who}: ${combined}`);
      continue;
    }
    const combined = textPart;
    if (!combined) continue;
    if (isLowSignalText(combined)) continue;
    let prefix = "[—]";
    if (m.timestamp) {
      try {
        const d = new Date(m.timestamp);
        if (!Number.isNaN(d.getTime())) {
          const y = d.getFullYear();
          const mo = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          const h = String(d.getHours()).padStart(2, "0");
          const min = String(d.getMinutes()).padStart(2, "0");
          prefix = `[${y}-${mo}-${day} ${h}:${min}]`;
        }
      } catch {
        // keep [—]
      }
    }
    lines.push(`${prefix} ${who}: ${combined}`);
  }
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  const tStart = Date.now();
  let body: Record<string, unknown> = {};
  let chatId: string | null = null;
  let contactName: string | null = null;
  let accountId: string | null = null;
  let onePromptMode = false;
  let requestId: string | undefined;
  try {
    body = await request.json().catch(() => ({}));
    chatId = typeof body?.chatId === "string" ? body.chatId.trim() : null;
    const contactNameRaw = typeof body?.contactName === "string" ? body.contactName.trim() : null;
    contactName = contactNameRaw || null;
    accountId = typeof body?.accountId === "string" ? body.accountId.trim() || null : null;
    if (!chatId) {
      logTodoListAnalysisError(
        { chatId: null, accountId, contactName, body: { chatId: body?.chatId, accountId: body?.accountId, contactName: body?.contactName } },
        { status: 400, error: "Missing or invalid chatId" }
      );
      return NextResponse.json({ error: "Missing or invalid chatId" }, { status: 400 });
    }

    const chatIdValue = chatId;
    const settings = readTodoSettings();
    const bodyMode = body?.messageScanMode;
    const mode: "count" | "age" | "both" =
      bodyMode === "count" || bodyMode === "age" || bodyMode === "both"
        ? bodyMode
        : settings.todoListMessageScanMode;
    const bodyMaxMessages =
      typeof body?.maxMessages === "number" && !Number.isNaN(body.maxMessages)
        ? Math.min(MAX_CHAT_MESSAGES, Math.max(0, Math.round(body.maxMessages)))
        : null;
    const bodyMaxAgeDays =
      typeof body?.maxMessageAgeDays === "number" && !Number.isNaN(body.maxMessageAgeDays)
        ? Math.max(1, Math.round(body.maxMessageAgeDays))
        : null;
    const maxMessages = Math.min(
      MAX_CHAT_MESSAGES,
      Math.max(0, bodyMaxMessages ?? settings.todoListMessageLimit)
    );
    const maxAgeDays = bodyMaxAgeDays ?? settings.todoListMaxMessageAgeDays;
    const minTimestampMs =
      mode === "age" || mode === "both" ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000 : null;
    const maxCount = mode === "count" || mode === "both" ? maxMessages : null;
    const defaultDeadlineDays = settings.todoListDefaultDeadlineDays;
    const defaultDurationHours = settings.todoListDefaultDurationHours;
    const onePrompt = typeof body?.onePrompt === "string" ? body.onePrompt.trim() : "";
    onePromptMode = onePrompt.length > 0;
    const promptSuffix = typeof body?.promptSuffix === "string" ? body.promptSuffix.trim() : "";
    const systemPrompt = onePromptMode
      ? "Du analysierst den Chat streng nach dem angegebenen One-Prompt. Gib nur relevante Ergebnisse zurück. Wenn kein Treffer vorliegt, antworte leer."
      : settings.todoListPrompt + (promptSuffix ? `\n\n${promptSuffix}` : "");
    const streamProgress = body?.stream === true;
    const force = body?.force === true;
    const attachmentMode = body?.attachmentMode === "fast" ? "fast" : "full";
    const processAttachments = attachmentMode === "full";

    requestId = randomUUID();
    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: chatIdValue,
      accountId,
      phase: "incoming_request",
      requestId,
      stream: streamProgress,
      request: { body: sanitizeTodoAnalyzeClientBody(body) },
    });

    const todoPromptHash = computeTodoAnalysisPromptHash({
      systemPrompt,
      mode,
      maxCount: maxCount ?? null,
      minTimestampMs: minTimestampMs ?? null,
      attachmentMode: processAttachments ? "full" : "fast",
      onePrompt: onePromptMode ? onePrompt : null,
    });

    const cached = getTodoSuggestions(chatIdValue);
    const latestMarker = await fetchLatestChatMarker(chatIdValue);
    const latestMessageDate = toDateOnly(latestMarker.timestamp ?? undefined) ?? new Date().toISOString().slice(0, 10);

    const hasCacheMarkerHit =
      !force &&
      !onePromptMode &&
      cached &&
      cached.last_message_sort_key &&
      latestMarker.sortKey &&
      cached.last_message_sort_key === latestMarker.sortKey &&
      !!cached.todo_prompt_hash &&
      cached.todo_prompt_hash === todoPromptHash;

    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: chatIdValue,
      accountId,
      phase: "cache_marker_evaluated",
      requestId,
      response: {
        hasCacheMarkerHit,
        latestSortKey: latestMarker.sortKey,
        cachedSortKey: cached?.last_message_sort_key ?? null,
        cachedPromptHash: cached?.todo_prompt_hash ?? null,
        requestPromptHash: todoPromptHash,
        force,
        onePromptMode,
      },
    });

    if (streamProgress) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            if (hasCacheMarkerHit) {
              const ndjson =
                JSON.stringify({
                  type: "result",
                  todos: cached?.todos ?? [],
                  estimated_total_hours: getEstimatedTotalHours(cached?.todos ?? []),
                  last_message_date: cached?.last_message_date ?? latestMessageDate,
                  message_count: 0,
                  skipped_by_cache: true,
                  ...zeroAnalyzeUsageCostMeta(),
                }) + "\n";
              controller.enqueue(encoder.encode(ndjson));
              appendTodoAnalysisTrace({
                ts: new Date().toISOString(),
                chatId: chatIdValue,
                accountId,
                requestId,
                phase: "stream_ndjson_out",
                response: { linePreview: ndjson.slice(0, 4000), skipped_by_cache: true },
              });
              return;
            }
            let messageFetchRounds = 0;
            const tFetch = Date.now();
            const baseMessages = await fetchLastMessages(chatIdValue, {
              maxCount,
              minTimestampMs,
              onPage: (page) => {
                messageFetchRounds = page;
                controller.enqueue(encoder.encode(JSON.stringify({ type: "messages_page", page }) + "\n"));
              },
            });
            const messages = selectMessagesForDelta(baseMessages, force || onePromptMode ? null : (cached?.last_analyzed_sort_key ?? null));
            appendTodoAnalysisTrace({
              ts: new Date().toISOString(),
              chatId: chatIdValue,
              accountId,
              requestId,
              phase: "messages_prepared",
              response: {
                baseMessageCount: baseMessages.length,
                deltaMessageCount: messages.length,
                messageFetchRounds,
                durationMs: Date.now() - tFetch,
              },
            });
            log.info(
              { chatId, step: "fetchMessages", durationMs: Date.now() - tFetch, messageCount: messages.length, baseMessageCount: baseMessages.length },
              "todo-list analyze timing"
            );
            if (messages.length === 0) {
              const todos = force ? [] : (cached?.todos ?? []);
              const ndjson =
                JSON.stringify({
                  type: "result",
                  todos,
                  estimated_total_hours: getEstimatedTotalHours(todos),
                  last_message_date: latestMessageDate,
                  message_count: 0,
                  message_fetch_rounds: messageFetchRounds,
                  skipped_by_delta: !force,
                  ...zeroAnalyzeUsageCostMeta(),
                }) + "\n";
              controller.enqueue(encoder.encode(ndjson));
              appendTodoAnalysisTrace({
                ts: new Date().toISOString(),
                chatId: chatIdValue,
                accountId,
                requestId,
                phase: "stream_ndjson_out",
                response: { linePreview: ndjson.slice(0, 4000), skipped_by_delta: !force, message_count: 0 },
              });
              return;
            }
            const lastMsg = messages[messages.length - 1];
            const lastAnalyzedSortKey = lastMsg.sortKey ?? latestMarker.sortKey ?? null;
            const lastMessageDate = toDateOnly(lastMsg.timestamp) ?? latestMessageDate;
            const today = new Date().toISOString().slice(0, 10);
            const transcript = await buildTranscriptWithDatesAndTranscription(messages, { contactName: contactName ?? undefined, processAttachments });
            const contactLine = contactName
              ? `Kontaktname (Vorname als Prefix für jeden Todo-Titel verwenden): ${contactName}\n\n`
              : "";
            const userContent = onePromptMode
              ? `Heutiges Datum: ${today}.\n\nONE-PROMPT:\n${onePrompt}\n\n${contactLine}Chat-Verlauf (Datum pro Nachricht; Sprachnachrichten transkribiert; Bilder per KI beschrieben):\n${transcript}`
              : `Heutiges Datum: ${today}.\n\n${contactLine}Chat-Verlauf (Datum pro Nachricht; Sprachnachrichten transkribiert; Bilder per KI beschrieben):\n${transcript}`;
            if (!OPENAI_API_KEY) {
              const errLine = JSON.stringify({ type: "error", error: "OpenAI API key not configured" }) + "\n";
              appendTodoAnalysisTrace({
                ts: new Date().toISOString(),
                chatId: chatIdValue,
                accountId,
                requestId,
                phase: "openai_skipped",
                error: "OpenAI API key not configured",
                response: { ndjsonPreview: errLine },
              });
              controller.enqueue(encoder.encode(errLine));
              return;
            }
            logTodoListAnalysisPrompt(chatIdValue, systemPrompt, userContent);
            const payload: Record<string, unknown> = {
              model: "gpt-4o-mini",
              messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
              temperature: 0.2,
            };
            if (!onePromptMode) {
              payload.response_format = { type: "json_object" };
            }
            appendTodoAnalysisTrace({
              ts: new Date().toISOString(),
              chatId: chatIdValue,
              accountId,
              requestId,
              phase: "transcript_built",
              response: {
                transcriptChars: transcript.length,
                userContentChars: userContent.length,
                messageCountForModel: messages.length,
              },
            });
            appendTodoAnalysisTrace({
              ts: new Date().toISOString(),
              chatId: chatIdValue,
              accountId,
              requestId,
              phase: "openai_request",
              request: {
                url: "https://api.openai.com/v1/chat/completions",
                json: summarizeOpenAiChatPayload(payload),
              },
            });
            const tOpenAi = Date.now();
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
              body: JSON.stringify(payload),
            });
            const data = (await res.json()) as {
              error?: { message?: string };
              choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };
            appendTodoAnalysisTrace({
              ts: new Date().toISOString(),
              chatId: chatIdValue,
              accountId,
              requestId,
              phase: "openai_response",
              durationMs: Date.now() - tOpenAi,
              response: {
                httpStatus: res.status,
                ok: res.ok,
                usage: data.usage ?? null,
                openaiError: data.error ?? null,
                choicesCount: data.choices?.length ?? 0,
                firstFinishReason: data.choices?.[0]?.finish_reason ?? null,
                body: summarizeOpenAiResponseBody(data),
              },
            });
            if (!res.ok) {
              const errLine = JSON.stringify({ type: "error", error: data?.error?.message ?? res.statusText }) + "\n";
              appendTodoAnalysisTrace({
                ts: new Date().toISOString(),
                chatId: chatIdValue,
                accountId,
                requestId,
                phase: "openai_http_error",
                response: { ndjsonPreview: errLine.slice(0, 2000) },
              });
              controller.enqueue(encoder.encode(errLine));
              return;
            }
            trackOpenAiUsageEvent({
              category: "todo_analyze",
              model: "gpt-4o-mini",
              usage: data.usage ?? null,
              chatId: chatIdValue,
            });
            const raw = data?.choices?.[0]?.message?.content;
            if (!raw || typeof raw !== "string") {
              const errLine = JSON.stringify({ type: "error", error: "Empty OpenAI response" }) + "\n";
              appendTodoAnalysisTrace({
                ts: new Date().toISOString(),
                chatId: chatIdValue,
                accountId,
                requestId,
                phase: "openai_empty_content",
                error: "Empty OpenAI response",
                response: { ndjsonPreview: errLine, rawContentType: typeof raw },
              });
              controller.enqueue(encoder.encode(errLine));
              return;
            }
            const todayDate = new Date(today);
            const defaultDue = new Date(todayDate);
            defaultDue.setDate(defaultDue.getDate() + defaultDeadlineDays);
            const defaultDueStr = defaultDue.toISOString().slice(0, 10);
            let todos: TodoSuggestionItem[] = [];
            try {
              todos = parseOpenAiOutputToTodos(raw, contactName, defaultDueStr, defaultDurationHours, onePromptMode);
            } catch {
              const errLine = JSON.stringify({ type: "error", error: "Invalid JSON from OpenAI" }) + "\n";
              appendTodoAnalysisTrace({
                ts: new Date().toISOString(),
                chatId: chatIdValue,
                accountId,
                requestId,
                phase: "openai_parse_todos_failed",
                response: { ndjsonPreview: errLine, rawAssistantPreview: raw.slice(0, 4000) },
              });
              controller.enqueue(encoder.encode(errLine));
              return;
            }
            setTodoSuggestions(chatIdValue, lastMessageDate, latestMarker.sortKey, lastAnalyzedSortKey, todos, todoPromptHash);
            const ndjsonResult =
              JSON.stringify({
                type: "result",
                todos,
                estimated_total_hours: getEstimatedTotalHours(todos),
                last_message_date: lastMessageDate,
                message_count: messages.length,
                message_fetch_rounds: messageFetchRounds,
                ...buildAnalyzeUsageCostMeta(data.usage),
              }) + "\n";
            appendTodoAnalysisTrace({
              ts: new Date().toISOString(),
              chatId: chatIdValue,
              accountId,
              requestId,
              phase: "stream_ndjson_out",
              response: {
                linePreview: ndjsonResult.slice(0, 6000),
                todoCount: todos.length,
                message_count: messages.length,
              },
            });
            controller.enqueue(encoder.encode(ndjsonResult));
          } catch (e) {
            const err = e instanceof Error ? e.message : "Todo analysis failed";
            const errLine = JSON.stringify({ type: "error", error: err }) + "\n";
            appendTodoAnalysisTrace({
              ts: new Date().toISOString(),
              chatId: chatIdValue,
              accountId,
              requestId,
              phase: "stream_fatal",
              error: err,
              stackPreview: e instanceof Error ? e.stack?.slice(0, 4000) : undefined,
              response: { ndjsonPreview: errLine.slice(0, 2000) },
            });
            controller.enqueue(encoder.encode(errLine));
          } finally {
            try {
              controller.close();
            } catch {
              // Stream might already be closed/cancelled by runtime.
            }
          }
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
      });
    }

    if (hasCacheMarkerHit) {
      const bodyOut = {
        todos: cached?.todos ?? [],
        estimated_total_hours: getEstimatedTotalHours(cached?.todos ?? []),
        last_message_date: cached?.last_message_date ?? latestMessageDate,
        message_count: 0,
        skipped_by_cache: true,
        ...zeroAnalyzeUsageCostMeta(),
      };
      appendTodoAnalysisTrace({
        ts: new Date().toISOString(),
        chatId: chatIdValue,
        accountId,
        requestId,
        phase: "json_response",
        response: { httpStatus: 200, body: summarizeOpenAiResponseBody(bodyOut) },
      });
      return NextResponse.json(bodyOut);
    }

    const tFetch = Date.now();
    const baseMessages = await fetchLastMessages(chatIdValue, { maxCount, minTimestampMs });
    const messages = selectMessagesForDelta(baseMessages, force || onePromptMode ? null : (cached?.last_analyzed_sort_key ?? null));
    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: chatIdValue,
      accountId,
      requestId,
      phase: "messages_prepared",
      response: {
        baseMessageCount: baseMessages.length,
        deltaMessageCount: messages.length,
        durationMs: Date.now() - tFetch,
      },
    });
    log.info(
      { chatId, step: "fetchMessages", durationMs: Date.now() - tFetch, messageCount: messages.length, baseMessageCount: baseMessages.length },
      "todo-list analyze timing"
    );
    if (messages.length === 0) {
      const todos = force ? [] : (cached?.todos ?? []);
      const bodyOut = {
        todos,
        estimated_total_hours: getEstimatedTotalHours(todos),
        last_message_date: cached?.last_message_date ?? latestMessageDate,
        message_count: 0,
        skipped_by_delta: !force,
        ...zeroAnalyzeUsageCostMeta(),
      };
      appendTodoAnalysisTrace({
        ts: new Date().toISOString(),
        chatId: chatIdValue,
        accountId,
        requestId,
        phase: "json_response",
        response: { httpStatus: 200, body: summarizeOpenAiResponseBody(bodyOut) },
      });
      return NextResponse.json(bodyOut);
    }

    const lastMsg = messages[messages.length - 1];
    const lastAnalyzedSortKey = lastMsg.sortKey ?? latestMarker.sortKey ?? null;
    const lastMessageDate = toDateOnly(lastMsg.timestamp) ?? latestMessageDate;

    const today = new Date().toISOString().slice(0, 10);
    const tTranscript = Date.now();
    const transcript = await buildTranscriptWithDatesAndTranscription(messages, { contactName: contactName ?? undefined, processAttachments });
    log.info({ chatId, step: "transcriptWithTranscribeAndVision", durationMs: Date.now() - tTranscript }, "todo-list analyze timing");
    const contactLine = contactName
      ? `Kontaktname (Vorname als Prefix für jeden Todo-Titel verwenden): ${contactName}\n\n`
      : "";
    const userContent = onePromptMode
      ? `Heutiges Datum: ${today}.\n\nONE-PROMPT:\n${onePrompt}\n\n${contactLine}Chat-Verlauf (Datum pro Nachricht; Sprachnachrichten transkribiert; Bilder per KI beschrieben):\n${transcript}`
      : `Heutiges Datum: ${today}.\n\n${contactLine}Chat-Verlauf (Datum pro Nachricht; Sprachnachrichten transkribiert; Bilder per KI beschrieben):\n${transcript}`;
    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: chatIdValue,
      accountId,
      requestId,
      phase: "transcript_built",
      response: {
        transcriptChars: transcript.length,
        userContentChars: userContent.length,
        messageCountForModel: messages.length,
      },
    });

    if (!OPENAI_API_KEY) {
      appendTodoAnalysisTrace({
        ts: new Date().toISOString(),
        chatId: chatIdValue,
        accountId,
        requestId,
        phase: "openai_skipped",
        error: "OpenAI API key not configured",
        response: { httpStatus: 502 },
      });
      logTodoListAnalysisError(
        { chatId, accountId, contactName, messageCount: messages.length, transcriptLength: transcript.length, body: { chatId, accountId, contactName } },
        { status: 502, error: "OpenAI API key not configured" }
      );
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 502 });
    }

    log.info({ chatId, messageCount: messages.length }, "todo-list analyze OpenAI call");
    logTodoListAnalysisPrompt(chatIdValue, systemPrompt, userContent);
    const tOpenAi = Date.now();
    const payload: Record<string, unknown> = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
    };
    if (!onePromptMode) {
      payload.response_format = { type: "json_object" };
    }

    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: chatIdValue,
      accountId,
      requestId,
      phase: "openai_request",
      request: {
        url: "https://api.openai.com/v1/chat/completions",
        json: summarizeOpenAiChatPayload(payload),
      },
    });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: chatIdValue,
      accountId,
      requestId,
      phase: "openai_response",
      durationMs: Date.now() - tOpenAi,
      response: {
        httpStatus: res.status,
        ok: res.ok,
        usage: data.usage ?? null,
        openaiError: data.error ?? null,
        choicesCount: data.choices?.length ?? 0,
        firstFinishReason: data.choices?.[0]?.finish_reason ?? null,
        body: summarizeOpenAiResponseBody(data),
      },
    });

    if (!res.ok) {
      const err = data?.error?.message ?? res.statusText;
      const status = res.status >= 500 ? 502 : 400;
      const errBody = { error: err };
      appendTodoAnalysisTrace({
        ts: new Date().toISOString(),
        chatId: chatIdValue,
        accountId,
        requestId,
        phase: "json_response_error",
        response: { httpStatus: status, body: summarizeOpenAiResponseBody(errBody) },
      });
      logTodoListAnalysisError(
        { chatId, accountId, contactName, messageCount: messages.length, transcriptLength: transcript.length, body: { chatId, accountId, contactName } },
        { status, error: err, openaiResponseSnippet: JSON.stringify(data).slice(0, 500) }
      );
      return NextResponse.json({ error: err }, { status });
    }

    trackOpenAiUsageEvent({
      category: "todo_analyze",
      model: "gpt-4o-mini",
      usage: data.usage ?? null,
      chatId: chatIdValue,
    });
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") {
      const errBody = { error: "Empty OpenAI response" };
      appendTodoAnalysisTrace({
        ts: new Date().toISOString(),
        chatId: chatIdValue,
        accountId,
        requestId,
        phase: "openai_empty_content",
        error: "Empty OpenAI response",
        response: { body: summarizeOpenAiResponseBody(errBody), rawContentType: typeof raw },
      });
      logTodoListAnalysisError(
        { chatId, accountId, contactName, messageCount: messages.length, transcriptLength: transcript.length, body: { chatId, accountId, contactName } },
        { status: 502, error: "Empty OpenAI response", openaiResponseSnippet: JSON.stringify(data).slice(0, 500) }
      );
      return NextResponse.json({ error: "Empty OpenAI response" }, { status: 502 });
    }

    const todayDate = new Date(today);
    const defaultDue = new Date(todayDate);
    defaultDue.setDate(defaultDue.getDate() + defaultDeadlineDays);
    const defaultDueStr = defaultDue.toISOString().slice(0, 10);

    let todos: TodoSuggestionItem[] = [];
    try {
      todos = parseOpenAiOutputToTodos(raw, contactName, defaultDueStr, defaultDurationHours, onePromptMode);
    } catch {
      const snippet = raw.slice(0, 500);
      appendTodoAnalysisTrace({
        ts: new Date().toISOString(),
        chatId: chatIdValue,
        accountId,
        requestId,
        phase: "openai_parse_todos_failed",
        response: { rawAssistantPreview: snippet },
      });
      logTodoListAnalysisError(
        { chatId, accountId, contactName, messageCount: messages.length, transcriptLength: transcript.length, body: { chatId, accountId, contactName } },
        { status: 502, error: "Invalid JSON from OpenAI", openaiResponseSnippet: snippet }
      );
      return NextResponse.json({ error: "Invalid JSON from OpenAI" }, { status: 502 });
    }
    setTodoSuggestions(chatIdValue, lastMessageDate, latestMarker.sortKey, lastAnalyzedSortKey, todos, todoPromptHash);

    log.info({ chatId, step: "openai", durationMs: Date.now() - tOpenAi }, "todo-list analyze timing");
    log.info({ chatId, todoCount: todos.length, messageCount: messages.length, totalDurationMs: Date.now() - tStart }, "todo-list analyze done");
    const successBody = {
      todos,
      estimated_total_hours: getEstimatedTotalHours(todos),
      last_message_date: lastMessageDate,
      message_count: messages.length,
      ...buildAnalyzeUsageCostMeta(data.usage),
    };
    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: chatIdValue,
      accountId,
      requestId,
      phase: "json_response",
      response: { httpStatus: 200, body: summarizeOpenAiResponseBody(successBody) },
    });
    return NextResponse.json(successBody);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Todo analysis failed";
    const stack = e instanceof Error ? e.stack : undefined;
    log.error({ err: e }, "todo-list analyze failed");
    appendTodoAnalysisTrace({
      ts: new Date().toISOString(),
      chatId: chatId ?? "unknown",
      accountId,
      phase: "handler_fatal",
      requestId,
      error: message,
      stackPreview: stack?.slice(0, 6000),
    });
    logTodoListAnalysisError(
      { chatId: chatId ?? null, accountId, contactName, body: { chatId: body?.chatId, accountId: body?.accountId, contactName: body?.contactName } },
      { status: 502, error: message, stack }
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
