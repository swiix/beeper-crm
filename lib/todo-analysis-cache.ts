import { MAX_CHAT_MESSAGES } from "@/lib/chat-message-limits";
import { computeTodoAnalysisPromptHash } from "@/lib/todo-prompt-hash";
import { getTodoSuggestions } from "@/lib/todo-db";
import { readTodoSettings } from "@/lib/todo-settings";
import type { TodoAnalyzeAttachmentMode, TodoAnalyzeScanMode } from "@/lib/settings";
import { computeAnalyzeMaxAgeDays } from "@/components/todo/TodoAnalyzeSettingsForm";
import type { TodoAnalyzeSettingsValues } from "@/components/todo/TodoAnalyzeSettingsForm";

export type ResolvedTodoAnalyzeRequest = {
  mode: TodoAnalyzeScanMode;
  maxMessages: number;
  maxAgeDays: number;
  minTimestampMs: number | null;
  maxCount: number | null;
  force: boolean;
  attachmentMode: TodoAnalyzeAttachmentMode;
  processAttachments: boolean;
  onePrompt: string;
  onePromptMode: boolean;
  promptSuffix: string;
  systemPrompt: string;
  todoPromptHash: string;
};

export function resolveTodoAnalyzeRequestFromSettings(
  settings: TodoAnalyzeSettingsValues,
  options?: { forOnePrompt?: boolean }
): ResolvedTodoAnalyzeRequest {
  const stored = readTodoSettings();
  const scanMode = settings.scanMode;
  const maxAgeDays = computeAnalyzeMaxAgeDays(settings.maxAgeValue, settings.maxAgeUnit);
  const maxMessages = Math.min(
    MAX_CHAT_MESSAGES,
    Math.max(0, Math.round(settings.maxMessages || stored.todoListMessageLimit))
  );
  const minTimestampMs =
    scanMode === "age" || scanMode === "both" ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000 : null;
  const maxCount = scanMode === "count" || scanMode === "both" ? maxMessages : null;
  const onePrompt = (options?.forOnePrompt ? settings.onePromptAllChats : "").trim();
  const onePromptMode = onePrompt.length > 0;
  const promptSuffix = settings.promptSuffix.trim();
  const attachmentMode = settings.attachmentMode === "fast" ? "fast" : "full";
  const processAttachments = attachmentMode === "full";
  const systemPrompt = onePromptMode
    ? "Du analysierst den Chat streng nach dem angegebenen One-Prompt. Gib nur relevante Ergebnisse zurück. Wenn kein Treffer vorliegt, antworte leer."
    : stored.todoListPrompt + (promptSuffix ? `\n\n${promptSuffix}` : "");
  const todoPromptHash = computeTodoAnalysisPromptHash({
    systemPrompt,
    mode: scanMode,
    maxCount: maxCount ?? null,
    minTimestampMs: minTimestampMs ?? null,
    attachmentMode: processAttachments ? "full" : "fast",
    onePrompt: onePromptMode ? onePrompt : null,
  });
  return {
    mode: scanMode,
    maxMessages,
    maxAgeDays,
    minTimestampMs,
    maxCount,
    force: settings.analyzeForce,
    attachmentMode,
    processAttachments,
    onePrompt,
    onePromptMode,
    promptSuffix,
    systemPrompt,
    todoPromptHash,
  };
}

export function evaluateTodoCacheMarkerHit(params: {
  force: boolean;
  onePromptMode: boolean;
  cached: ReturnType<typeof getTodoSuggestions> | null;
  latestSortKey: string | null;
  todoPromptHash: string;
}): boolean {
  const { force, onePromptMode, cached, latestSortKey, todoPromptHash } = params;
  if (force || onePromptMode) return false;
  if (!cached?.last_message_sort_key || !latestSortKey) return false;
  if (cached.last_message_sort_key !== latestSortKey) return false;
  if (!cached.todo_prompt_hash || cached.todo_prompt_hash !== todoPromptHash) return false;
  return true;
}

export type FetchLatestChatSortKey = (chatId: string) => Promise<string | null>;

export async function isTodoAnalysisCacheFresh(
  chatId: string,
  resolved: ResolvedTodoAnalyzeRequest,
  fetchLatestSortKey: FetchLatestChatSortKey
): Promise<boolean> {
  const cached = getTodoSuggestions(chatId);
  const latestSortKey = await fetchLatestSortKey(chatId);
  return evaluateTodoCacheMarkerHit({
    force: resolved.force,
    onePromptMode: resolved.onePromptMode,
    cached,
    latestSortKey,
    todoPromptHash: resolved.todoPromptHash,
  });
}

export const TODO_ANALYZE_PREVIEW_CONCURRENCY = 25;
export const TODO_ANALYZE_PREVIEW_MAX_CHATS = 2000;
export const TODO_ANALYZE_AVG_SEC_PER_CHAT = 12;
export const TODO_ANALYZE_BATCH_CONCURRENCY = 5;

export function estimateAnalyzeMinutes(needsAnalyze: number): number {
  if (needsAnalyze <= 0) return 0;
  return Math.max(1, Math.ceil((needsAnalyze / TODO_ANALYZE_BATCH_CONCURRENCY) * (TODO_ANALYZE_AVG_SEC_PER_CHAT / 60)));
}
