import { NextRequest, NextResponse } from "next/server";
import type { ContactAnalysis } from "@/lib/types";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getCacheTTLMs } from "@/lib/cache-settings";
import { createLogger } from "@/lib/logger";
import { beeperJson } from "@/lib/beeper";
import { resolveBeeperMessagesBeforeCursor } from "@/lib/beeper-messages-cursor";
import {
  readPrompts,
  DEFAULT_TINDER_SUGGESTIONS_COUNT,
} from "@/lib/prompts-store";
import { getTranscript } from "@/lib/transcribe";
import { getPriorities } from "@/lib/tinder-priority-store";
import { getAnalysis, getAnalysisCacheRow, saveAnalysis } from "@/lib/analysis-db";
import { computeAnalysisPromptHash, ANALYSIS_CHAT_MODEL } from "@/lib/analysis-prompt-hash";
import { getOrRunInflightAnalysis, inflightAnalysisKey } from "@/lib/analysis-inflight";

const log = createLogger("api:analyze");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANALYSIS_MESSAGE_LIMIT: number | null = null;
const CHUNK_MESSAGE_SIZE = 60;
const LONG_CHAT_MODE_THRESHOLD = 120;
const MODEL_MAX_CONTEXT_TOKENS = 128000;
const SAFE_REQUEST_INPUT_TOKENS = 110000;
const SAFE_CHUNK_INPUT_TOKENS = 24000;
const MIN_CHUNK_SIZE = 8;

interface AudioAttachment {
  type?: string;
  srcURL?: string;
  id?: string;
}

interface MessageItem {
  text?: string;
  senderName?: string;
  isSender?: boolean;
  attachments?: AudioAttachment[];
}

function isAudioAttachment(a: AudioAttachment): boolean {
  const t = (a.type ?? "").toLowerCase();
  return t === "audio";
}

/** Build transcript for analysis: text messages + transcribed audio (all visible audios transcribed first). */
async function buildMessagesPayloadWithTranscription(
  messages: MessageItem[],
  contactName?: string
): Promise<string> {
  const lines: string[] = [];
  for (const m of messages) {
    const who = m.isSender ? "Ich" : (m.senderName ?? contactName ?? "Gegenüber");
    const textPart = (m.text ?? "").trim();
    const audioAttachments = (m.attachments ?? []).filter(isAudioAttachment);
    const transcripts: string[] = [];
    for (const att of audioAttachments) {
      const audioUrl = att.srcURL ?? att.id ?? "";
      if (audioUrl) {
        const t = await getTranscript(audioUrl);
        if (t) transcripts.push(t);
      }
    }
    const audioPart =
      transcripts.length > 0
        ? `[Sprachnachricht]: ${transcripts.join(" ")}`
        : "";
    const combined = [textPart, audioPart].filter(Boolean).join(" ");
    if (combined) lines.push(`${who}: ${combined}`);
  }
  return lines.join("\n");
}

/** Beeper messages list response: no nextCursor; use message.sortKey as cursor for next page. */
interface BeeperMessagesResponse {
  items?: Array<MessageItem & { sortKey?: string }>;
  hasMore?: boolean;
}

interface ChatMarker {
  sortKey: string | null;
}

async function fetchLatestChatMarker(chatId: string): Promise<ChatMarker> {
  const path = `/v1/chats/${encodeURIComponent(chatId)}/messages`;
  const data = await beeperJson<BeeperMessagesResponse>(path);
  const newest = data?.items?.[0];
  return { sortKey: newest?.sortKey ?? null };
}

function markerCacheKey(chatId: string, isTinder: boolean): string {
  return `analysis:marker:${chatId}${isTinder ? ":tinder" : ""}`;
}

function analysisCacheKey(chatId: string, isTinder: boolean): string {
  return `analysis:${chatId}${isTinder ? ":tinder" : ""}`;
}

function loadCachedAnalysis(chatId: string, isTinder: boolean): ContactAnalysis | undefined {
  const cacheKey = analysisCacheKey(chatId, isTinder);
  let result = cacheGet<ContactAnalysis>(cacheKey);
  if (result === undefined) {
    const fromDb = getAnalysis(chatId, isTinder);
    if (fromDb) {
      result = fromDb;
      cacheSet(cacheKey, result, getCacheTTLMs("analysis"));
    }
  }
  return result;
}

/** True when SQLite row matches latest message marker and current prompt hash (survives process restart). */
function isPersistedAnalysisFresh(
  chatId: string,
  isTinder: boolean,
  latestSortKey: string | null,
  promptHash: string,
  requirePromptHash: boolean = true
): boolean {
  if (!latestSortKey) return false;
  const row = getAnalysisCacheRow(chatId, isTinder);
  if (!row?.lastMessageSortKey || !row.analysisPromptHash) return false;
  if (row.lastMessageSortKey !== latestSortKey) return false;
  return requirePromptHash ? row.analysisPromptHash === promptHash : true;
}

/** Fetch last messages for a chat (with attachments). Returns chronological (oldest first). */
async function fetchLastMessages(chatId: string, limit: number | null): Promise<MessageItem[]> {
  const collected: MessageItem[] = [];
  let cursor: string | null = null;
  const pathBase = `/v1/chats/${encodeURIComponent(chatId)}/messages`;
  for (;;) {
    const params = new URLSearchParams();
    if (cursor) {
      params.set("cursor", cursor);
      params.set("direction", "before");
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const data = await beeperJson<BeeperMessagesResponse>(`${pathBase}${suffix}`);
    const items = data?.items ?? [];
    for (const m of items) {
      collected.push({
        text: m.text,
        senderName: m.senderName,
        isSender: m.isSender,
        attachments: m.attachments,
      });
    }
    const hasMore = data?.hasMore ?? false;
    const nextCursor = resolveBeeperMessagesBeforeCursor(data ?? {});
    if ((limit != null && collected.length >= limit) || !hasMore || !nextCursor) break;
    cursor = nextCursor;
  }
  const last = limit != null ? collected.slice(0, limit) : collected;
  last.reverse();
  return last;
}

function getSystemPromptBase(): string {
  return readPrompts().analysisSystemPrompt;
}

function getQuickReplyPromptSuffix(): string {
  const p = readPrompts();
  return typeof p.quickReplyPromptSuffix === "string" ? p.quickReplyPromptSuffix.trim() : "";
}

const SUGGESTIONS_DEFAULT = 3;

function normalizeParsedAnalysis(parsed: Record<string, unknown>, suggestionsCount: number): ContactAnalysis {
  const priorityFromApi = (() => {
    const v = parsed.priorityIndex;
    if (typeof v === "number" && !Number.isNaN(v)) {
      return Math.min(10, Math.max(1, Math.round(v)));
    }
    if (typeof v === "string") {
      const n = parseInt(v.trim(), 10);
      if (!Number.isNaN(n)) return Math.min(10, Math.max(1, n));
    }
    return 5;
  })();
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    branche: typeof parsed.branche === "string" ? parsed.branche : undefined,
    kaufkraft: (() => {
      const v = parsed.kaufkraft;
      if (typeof v === "number") {
        return String(Math.min(10, Math.max(1, Math.round(v))));
      }
      if (typeof v === "string") {
        const n = parseInt(v.trim(), 10);
        if (!Number.isNaN(n)) return String(Math.min(10, Math.max(1, n)));
        return v.trim() || undefined;
      }
      return undefined;
    })(),
    wunsch: typeof parsed.wunsch === "string" ? parsed.wunsch : undefined,
    pain: typeof parsed.pain === "string" ? parsed.pain : undefined,
    stage: typeof parsed.stage === "string" ? parsed.stage : undefined,
    nextMessageSuggestions: Array.isArray(parsed.nextMessageSuggestions)
      ? (parsed.nextMessageSuggestions as unknown[])
          .filter((x): x is string => typeof x === "string")
          .slice(0, suggestionsCount)
      : undefined,
    priorityIndex: priorityFromApi,
  };
}

function estimateTokens(text: string): number {
  // Rough approximation for mixed DE/EN text.
  return Math.ceil(text.length / 4);
}

function trimToTokenBudget(text: string, maxTokens: number): string {
  if (!text) return text;
  const maxChars = Math.max(1000, maxTokens * 4);
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

async function callOpenAiJson(systemPrompt: string, userContent: string): Promise<Record<string, unknown>> {
  const systemTokens = estimateTokens(systemPrompt);
  const userTokens = estimateTokens(userContent);
  if (systemTokens + userTokens > SAFE_REQUEST_INPUT_TOKENS) {
    throw new Error(
      `Input too large before request (${systemTokens + userTokens} estimated tokens)`
    );
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: ANALYSIS_CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1400,
    }),
  });
  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!res.ok) {
    const err = data?.error?.message ?? res.statusText;
    throw new Error(err || "OpenAI request failed");
  }
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") {
    throw new Error("Empty OpenAI response");
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function buildSystemPrompt(
  contactName?: string,
  suggestionsCount: number = SUGGESTIONS_DEFAULT,
  isTinderView: boolean = false
): string {
  const base = getSystemPromptBase();
  const parts = [base];
  parts.push(
    "\nSprache: Erkenne die Hauptsprache des Chat-Verlaufs (z.B. Deutsch, Englisch, Spanisch) und formuliere die nextMessageSuggestions ausschließlich in dieser Sprache."
  );
  const kontext =
    "\nKontext für nextMessageSuggestions: Orientiere dich strikt an den Absender-Bezeichnungen (\"Ich\" = Nutzer, sonst = Kontakt) und der chronologischen Reihenfolge. " +
    "Prüfe, wer die letzte Nachricht geschrieben hat. " +
    "Wenn der Kontakt (nicht \"Ich\") zuletzt geschrieben hat: formuliere genau " +
    String(suggestionsCount) +
    " Antwortvorschläge, die auf seine Nachricht eingehen. " +
    "Wenn \"Ich\" (der Nutzer) zuletzt geschrieben hat: formuliere genau " +
    String(suggestionsCount) +
    " kurze Follow-up-Vorschläge (freundlicher Nachfasser, nicht aufdringlich). " +
    "Das Array nextMessageSuggestions muss immer genau " +
    String(suggestionsCount) +
    " Einträge haben.";
  parts.push(kontext);
  parts.push(
    "\nErledigte Vorgänge: Wenn aus dem Verlauf klar hervorgeht, dass ein Anliegen oder Problem bereits gelöst ist (z.B. Formulierungen wie \"Hat sich geklärt\", Bestätigungen, Dank, \"alles geklärt\"), dann formuliere nextMessageSuggestions als kurze, abschließende oder bestätigende Antworten – keine Angebote für weitere Unterstützung, als wäre das Thema noch offen. Kurz und freundlich abschließen, nicht nachfragen ob noch Fragen bestehen."
  );
  const quickReplySuffix = getQuickReplyPromptSuffix();
  if (quickReplySuffix) {
    parts.push(
      "\nZusatzregel nur für nextMessageSuggestions (Quick Reply): " + quickReplySuffix
    );
  }
  if (isTinderView) {
    parts.push(
      "\nSchreibstil: Die nextMessageSuggestions sollen den Schreibstil von \"Ich\" (dem Nutzer) aus dem Chat-Verlauf übernehmen – Tonfall, Länge und typische Formulierungen."
    );
    parts.push(
      "\nAnsprache: In den nextMessageSuggestions den Kontakt weder mit Nach- noch mit Vornamen ansprechen, nur duzen (du) oder neutral formulieren."
    );
    parts.push(
      "\npriorityIndex: Eine Zahl von 1 bis 10 (1 = niedrige Priorität, 10 = hohe Priorität). Bewerte, wie dringend oder wichtig es ist, diesen Chat als nächstes zu bearbeiten (z.B. letzte Nachricht vom Kontakt, Kaufbereitschaft, offene Fragen, Dringlichkeit). Das JSON muss priorityIndex als Zahl enthalten."
    );
    const stored = readPrompts();
    if (typeof stored.tinderPromptSuffix === "string" && stored.tinderPromptSuffix.trim()) {
      parts.push("\n" + stored.tinderPromptSuffix.trim());
    }
    if (typeof stored.tinderSummaryPromptSuffix === "string" && stored.tinderSummaryPromptSuffix.trim()) {
      parts.push(
        "\nZusatzregel nur fuer das Feld \"summary\": " + stored.tinderSummaryPromptSuffix.trim()
      );
    }
  }
  if (contactName?.trim()) {
    parts.push(
      `\nWichtig: Der Kontakt/Chat-Partner heißt "${contactName.trim()}". Beziehe dich in der Zusammenfassung auf diesen Namen. Formuliere die nextMessageSuggestions persönlich an ${contactName.trim()}; nutze dieselbe Sprache und Ansprache wie im Chatverlauf (you/du/tú etc., je nach tatsächlicher Chat-Sprache).`
    );
  }
  parts.push(NEXT_MESSAGE_LANGUAGE_LOCK_EN);
  return parts.join("");
}

/** Repeated at end of system prompt so it wins over German instruction text and Hormozi-style suffix. */
const NEXT_MESSAGE_LANGUAGE_LOCK_EN =
  "\nCRITICAL (nextMessageSuggestions language): Use the same language as the actual message text in the user payload (the lines after \"Ich:\" / contact labels). " +
  "Ignore the fact that these system instructions are in German. " +
  "If the transcript body is English, every suggestion must be English. If Spanish, Spanish. If German, German. " +
  "Never default to German for suggestions only because the CRM UI or instructions are German.";

/** Appended to user content so the model anchors language on transcript text, not on German CRM labels. */
function appendNextMessageLanguageReminderToUserPayload(userContent: string): string {
  return (
    userContent +
    "\n\n---\n" +
    "Language for nextMessageSuggestions: Match the language of the message lines above (the text after each sender label). " +
    "English transcript -> English suggestions only. German transcript -> German suggestions only. " +
    "Do not output German suggestions when the message text above is English."
  );
}

type GuardLanguage = "de" | "en";

function scoreLanguage(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of words) {
    const re = new RegExp(`\\b${w}\\b`, "g");
    score += (lower.match(re) ?? []).length;
  }
  return score;
}

/** Heuristic: detect only DE/EN when confidence is clear; otherwise no guard. */
function detectGuardLanguageFromTranscript(transcript: string): GuardLanguage | null {
  if (!transcript.trim()) return null;
  const deScore =
    scoreLanguage(transcript, ["und", "nicht", "ich", "du", "danke", "hallo", "bitte", "morgen"]) +
    (transcript.match(/[äöüß]/gi) ?? []).length;
  const enScore = scoreLanguage(transcript, ["and", "not", "i", "you", "thanks", "hello", "please", "tomorrow"]);
  if (deScore >= enScore + 3) return "de";
  if (enScore >= deScore + 3) return "en";
  return null;
}

function suggestionsMatchGuardLanguage(
  suggestions: string[] | undefined,
  expected: GuardLanguage | null
): boolean {
  if (!expected || !suggestions || suggestions.length === 0) return true;
  const joined = suggestions.join(" ").toLowerCase();
  const deSignals = scoreLanguage(joined, ["und", "nicht", "danke", "bitte", "hallo", "dir", "dein"]);
  const enSignals = scoreLanguage(joined, ["and", "not", "thanks", "please", "hello", "your"]);
  if (expected === "de") return deSignals >= Math.max(1, enSignals);
  return enSignals >= Math.max(1, deSignals);
}

function buildRuntimeLanguageRetrySuffix(expected: GuardLanguage): string {
  return (
    "\n\n---\n" +
    `Runtime language guard: Detected transcript language is ${expected.toUpperCase()}. ` +
    `For nextMessageSuggestions output ONLY ${expected.toUpperCase()} sentences. ` +
    "Do not mix languages and do not default to German because UI labels are German."
  );
}

/** GET: return analysis from memory cache or database (no OpenAI call). view=tinder uses Tinder cache (5 suggestions). */
export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get("chatId");
  const view = request.nextUrl.searchParams.get("view");
  if (!chatId || typeof chatId !== "string") {
    return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
  }
  const isTinder = view === "tinder";
  const suggestionsCount = isTinder
    ? (readPrompts().tinderSuggestionsCount ?? DEFAULT_TINDER_SUGGESTIONS_COUNT)
    : SUGGESTIONS_DEFAULT;
  const promptHash = computeAnalysisPromptHash(isTinder, suggestionsCount);
  let result = loadCachedAnalysis(chatId, isTinder);
  if (result === undefined) {
    return NextResponse.json({ error: "No cached analysis" }, { status: 404 });
  }
  try {
    const latest = await fetchLatestChatMarker(chatId);
    if (!isPersistedAnalysisFresh(chatId, isTinder, latest.sortKey ?? null, promptHash)) {
      return NextResponse.json({ error: "Cache outdated" }, { status: 404 });
    }
  } catch (e) {
    log.warn({ chatId, err: e }, "analyze-chat marker check failed in GET; serving cached analysis without live marker verify");
  }
  if (isTinder && result.priorityIndex === undefined) {
    const stored = getPriorities([chatId]);
    const priority = stored[chatId];
    result = priority !== undefined ? { ...result, priorityIndex: priority } : result;
  }
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 }
    );
  }

  let body: {
    chatId?: string;
    contactName?: string;
    force?: boolean;
    view?: string;
    /** Client label: which UI triggered the analysis (logged server-side). */
    source?: string;
    messages?: Array<{ text?: string; senderName?: string; isSender?: boolean }>;
  };
  try {
    body = await request.json();
  } catch {
    log.warn("analyze-chat invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tStart = Date.now();
  const invokeSource =
    typeof body.source === "string" && body.source.trim().length > 0 ? body.source.trim() : "unspecified";
  const chatId = body.chatId ?? "";
  const contactName = typeof body.contactName === "string" ? body.contactName.trim() : "";
  const force = body.force === true;
  const isTinder = body.view === "tinder";
  const suggestionsCount = isTinder
    ? (readPrompts().tinderSuggestionsCount ?? DEFAULT_TINDER_SUGGESTIONS_COUNT)
    : SUGGESTIONS_DEFAULT;
  const promptHash = computeAnalysisPromptHash(isTinder, suggestionsCount);
  const crmStrictMessageOnly = invokeSource.startsWith("crm");
  const cacheKey = chatId ? analysisCacheKey(chatId, isTinder) : null;
  const markerKey = chatId ? markerCacheKey(chatId, isTinder) : null;

  let latestMarker: ChatMarker | null = null;
  let markerPrefetchFailed = false;
  if (chatId) {
    try {
      latestMarker = await fetchLatestChatMarker(chatId);
    } catch (e) {
      markerPrefetchFailed = true;
      log.warn({ chatId, err: e }, "analyze-chat marker prefetch failed");
    }
  }

  // Persisted smart cache (SQLite marker + prompt hash; survives restarts)
  if (chatId && cacheKey && markerKey && !force) {
    const fallbackCached = loadCachedAnalysis(chatId, isTinder);
    if ((markerPrefetchFailed || !latestMarker?.sortKey) && fallbackCached) {
      cacheSet(cacheKey, fallbackCached, getCacheTTLMs("analysis"));
      cacheSet(markerKey, latestMarker?.sortKey ?? null, getCacheTTLMs("analysis"));
      log.info(
        { chatId, cacheHit: true, cacheLayer: "sqlite-fallback", invokeSource, markerPrefetchFailed },
        "analyze-chat smart cache fallback hit"
      );
      return NextResponse.json(fallbackCached);
    }
    if (
      latestMarker?.sortKey &&
      isPersistedAnalysisFresh(
        chatId,
        isTinder,
        latestMarker.sortKey,
        promptHash,
        !crmStrictMessageOnly
      )
    ) {
      const row = getAnalysisCacheRow(chatId, isTinder);
      if (row) {
        let cached = row.analysis;
        cacheSet(cacheKey, cached, getCacheTTLMs("analysis"));
        cacheSet(markerKey, latestMarker.sortKey, getCacheTTLMs("analysis"));
        log.info({ chatId, cacheHit: true, cacheLayer: "sqlite", invokeSource }, "analyze-chat smart cache hit");
        if (isTinder && cached.priorityIndex === undefined) {
          const stored = getPriorities([chatId]);
          const priority = stored[chatId];
          cached = priority !== undefined ? { ...cached, priorityIndex: priority } : cached;
        }
        return NextResponse.json(cached);
      }
    }
  }

  const runAnalysis = async (): Promise<ContactAnalysis> => {
    let messages: MessageItem[];
    if (chatId) {
      const tFetch = Date.now();
      try {
        messages = await fetchLastMessages(chatId, ANALYSIS_MESSAGE_LIMIT);
      } catch (e) {
        log.warn({ chatId, err: e }, "analyze-chat fetch messages failed");
        throw new Error("Could not load chat messages for analysis");
      }
      log.info(
        { chatId, step: "fetchMessages", durationMs: Date.now() - tFetch, messageCount: messages.length },
        "analyze-chat timing"
      );
    } else {
      messages = body.messages ?? [];
    }

    const tTranscribe = Date.now();
    log.info({ chatId, messageCount: messages.length }, "transcribing audio in messages…");
    const transcript = await buildMessagesPayloadWithTranscription(messages, contactName || undefined);
    log.info({ chatId, step: "transcribe", durationMs: Date.now() - tTranscribe }, "analyze-chat timing");
    if (!transcript.trim()) {
      log.warn("analyze-chat no messages");
      throw new Error("No messages to analyze");
    }

    log.info({ chatId: chatId || "none", messageCount: messages.length, force }, "analyze-chat (OpenAI)");
    const tOpenAi = Date.now();
    const senderHint =
      "Absender: Jede Zeile beginnt mit dem Absender – \"Ich\" = der Nutzer (du), jede andere Bezeichnung = der Kontakt/Chat-Partner. Die Reihenfolge ist chronologisch (älteste Nachricht zuerst).\n\n";
    const runtimeGuardLanguage = detectGuardLanguageFromTranscript(transcript);
    const baseSystemPrompt = buildSystemPrompt(contactName || undefined, suggestionsCount, isTinder);
    log.info(
      {
        chatId: chatId || undefined,
        invokeSource,
        promptHash,
        model: ANALYSIS_CHAT_MODEL,
        view: isTinder ? "tinder" : "default",
        suggestionsCount,
        systemPromptChars: baseSystemPrompt.length,
        longChatMode: messages.length >= LONG_CHAT_MODE_THRESHOLD,
        systemPrompt: baseSystemPrompt,
      },
      "analyze-chat system prompt (full)"
    );
    let result: ContactAnalysis;
    if (messages.length >= LONG_CHAT_MODE_THRESHOLD) {
      const chunks: MessageItem[][] = [];
      for (let i = 0; i < messages.length; i += CHUNK_MESSAGE_SIZE) {
        chunks.push(messages.slice(i, i + CHUNK_MESSAGE_SIZE));
      }
      const chunkSummaries: Record<string, unknown>[] = [];
      for (let i = 0; i < chunks.length; i += 1) {
        let candidateChunk = chunks[i];
        let chunkTranscript = await buildMessagesPayloadWithTranscription(candidateChunk, contactName || undefined);
        let chunkTokenEstimate = estimateTokens(chunkTranscript) + estimateTokens(baseSystemPrompt);
        while (chunkTokenEstimate > SAFE_CHUNK_INPUT_TOKENS && candidateChunk.length > MIN_CHUNK_SIZE) {
          candidateChunk = candidateChunk.slice(Math.floor(candidateChunk.length / 2));
          chunkTranscript = await buildMessagesPayloadWithTranscription(candidateChunk, contactName || undefined);
          chunkTokenEstimate = estimateTokens(chunkTranscript) + estimateTokens(baseSystemPrompt);
        }
        if (!chunkTranscript.trim()) continue;
        if (chunkTokenEstimate > SAFE_CHUNK_INPUT_TOKENS) {
          chunkTranscript = trimToTokenBudget(
            chunkTranscript,
            Math.max(2000, SAFE_CHUNK_INPUT_TOKENS - estimateTokens(baseSystemPrompt) - 3000)
          );
        }
        const chunkUserContent = contactName
          ? `Kontaktname: ${contactName}\n\n${senderHint}Analysiere diesen Chat-Teil ${i + 1}/${chunks.length}:\n\n${chunkTranscript}`
          : `${senderHint}Analysiere diesen Chat-Teil ${i + 1}/${chunks.length}:\n\n${chunkTranscript}`;
        const chunkUserForApi = appendNextMessageLanguageReminderToUserPayload(chunkUserContent);
        log.info(
          {
            chatId: chatId || undefined,
            invokeSource,
            pipeline: "chunk-pass",
            chunkIndex: i + 1,
            chunkTotal: chunks.length,
            userPayloadChars: chunkUserForApi.length,
            userPayload: chunkUserForApi,
          },
          "analyze-chat user payload (chunk)"
        );
        const chunkParsed = await callOpenAiJson(baseSystemPrompt, chunkUserForApi);
        chunkSummaries.push(chunkParsed);
      }
      let mergePayload = JSON.stringify(chunkSummaries);
      let mergeUserContent = `Fasse die folgenden Teilanalysen zu EINER finalen Analyse zusammen. Berücksichtige alle Teile, löse Widersprüche zugunsten der neuesten Informationen und gib ein einzelnes JSON im bekannten Schema zurück.\n\nTeilanalysen:\n${mergePayload}`;
      const mergeTokenBudget = SAFE_REQUEST_INPUT_TOKENS - estimateTokens(baseSystemPrompt) - 3000;
      if (estimateTokens(mergeUserContent) > mergeTokenBudget) {
        mergePayload = trimToTokenBudget(mergePayload, mergeTokenBudget);
        mergeUserContent = `Fasse die folgenden Teilanalysen zu EINER finalen Analyse zusammen. Berücksichtige alle Teile, löse Widersprüche zugunsten der neuesten Informationen und gib ein einzelnes JSON im bekannten Schema zurück.\n\nTeilanalysen:\n${mergePayload}`;
      }
      const mergeUserForApi =
        mergeUserContent +
        "\n\n---\n" +
        "For nextMessageSuggestions in the merged JSON: use the same language as the underlying chat (infer from partial analyses and summaries; English chat -> English suggestions only).";
      log.info(
        {
          chatId: chatId || undefined,
          invokeSource,
          pipeline: "chunk-merge",
          chunkCount: chunks.length,
          userPayloadChars: mergeUserForApi.length,
          userPayload: mergeUserForApi,
        },
        "analyze-chat user payload (merge)"
      );
      const mergedParsed = await callOpenAiJson(baseSystemPrompt, mergeUserForApi);
      result = normalizeParsedAnalysis(mergedParsed, suggestionsCount);
      if (!suggestionsMatchGuardLanguage(result.nextMessageSuggestions, runtimeGuardLanguage) && runtimeGuardLanguage) {
        log.warn(
          { chatId: chatId || undefined, invokeSource, guardLanguage: runtimeGuardLanguage, pipeline: "chunk-merge" },
          "analyze-chat suggestion language mismatch; retrying once with runtime guard"
        );
        const retryParsed = await callOpenAiJson(
          baseSystemPrompt,
          mergeUserForApi + buildRuntimeLanguageRetrySuffix(runtimeGuardLanguage)
        );
        result = normalizeParsedAnalysis(retryParsed, suggestionsCount);
      }
    } else {
      const userContent = contactName
        ? `Kontaktname: ${contactName}\n\n${senderHint}Analysiere diesen Chat-Verlauf:\n\n${transcript}`
        : `${senderHint}Analysiere diesen Chat-Verlauf:\n\n${transcript}`;
      const userContentWithReminder = appendNextMessageLanguageReminderToUserPayload(userContent);
      const fullInputEstimate = estimateTokens(baseSystemPrompt) + estimateTokens(userContentWithReminder);
      const safeUserContent =
        fullInputEstimate > SAFE_REQUEST_INPUT_TOKENS
          ? trimToTokenBudget(
              userContentWithReminder,
              Math.max(4000, SAFE_REQUEST_INPUT_TOKENS - estimateTokens(baseSystemPrompt) - 3000)
            )
          : userContentWithReminder;
      log.info(
        {
          chatId: chatId || undefined,
          invokeSource,
          pipeline: "single-pass",
          userPayloadChars: safeUserContent.length,
          userPayloadTrimmed: safeUserContent.length < userContentWithReminder.length,
          userPayload: safeUserContent,
        },
        "analyze-chat user payload (single)"
      );
      const parsed = await callOpenAiJson(baseSystemPrompt, safeUserContent);
      result = normalizeParsedAnalysis(parsed, suggestionsCount);
      if (!suggestionsMatchGuardLanguage(result.nextMessageSuggestions, runtimeGuardLanguage) && runtimeGuardLanguage) {
        log.warn(
          { chatId: chatId || undefined, invokeSource, guardLanguage: runtimeGuardLanguage, pipeline: "single-pass" },
          "analyze-chat suggestion language mismatch; retrying once with runtime guard"
        );
        const retryParsed = await callOpenAiJson(
          baseSystemPrompt,
          safeUserContent + buildRuntimeLanguageRetrySuffix(runtimeGuardLanguage)
        );
        result = normalizeParsedAnalysis(retryParsed, suggestionsCount);
      }
    }

    log.info(
      {
        chatId,
        step: "openai",
        durationMs: Date.now() - tOpenAi,
        modelMaxContextTokens: MODEL_MAX_CONTEXT_TOKENS,
        safeRequestInputTokens: SAFE_REQUEST_INPUT_TOKENS,
      },
      "analyze-chat timing"
    );
    if (chatId) {
      saveAnalysis(chatId, isTinder, result, {
        lastMessageSortKey: latestMarker?.sortKey ?? null,
        analysisPromptHash: promptHash,
      });
    }
    if (cacheKey) cacheSet(cacheKey, result, getCacheTTLMs("analysis"));
    if (markerKey) cacheSet(markerKey, latestMarker?.sortKey ?? null, getCacheTTLMs("analysis"));
    log.info({ chatId: cacheKey ?? undefined, totalDurationMs: Date.now() - tStart }, "analyze-chat done");
    return result;
  };

  try {
    let result: ContactAnalysis;
    if (!chatId) {
      result = await runAnalysis();
    } else {
      result = await getOrRunInflightAnalysis(inflightAnalysisKey(chatId, isTinder), runAnalysis);
    }
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analysis failed";
    if (message === "No messages to analyze") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message === "Could not load chat messages for analysis") {
      return NextResponse.json({ error: message }, { status: 502 });
    }
    log.error({ err: e, chatId }, "analyze-chat failed");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
