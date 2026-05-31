"use client";

import { useEffect, useState } from "react";

type OnePromptResultItem = {
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
};

export function OnePromptResultsDialog({
  open,
  results,
  loading,
  error,
  targetCount,
  processedCount,
  onClose,
  onOpenChat,
  onAcceptOne,
  onAcceptAll,
  onIgnoreOne,
  acceptingByChatId,
}: {
  open: boolean;
  results: OnePromptResultItem[];
  loading: boolean;
  error: string | null;
  targetCount: number;
  processedCount: number;
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
  onAcceptOne: (result: OnePromptResultItem) => void;
  onAcceptAll: () => void;
  onIgnoreOne: (chatId: string) => void;
  acceptingByChatId: Record<string, boolean>;
}) {
  const [onlyStrictContacts, setOnlyStrictContacts] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);

  const visibleResults = onlyStrictContacts
    ? results.filter((r) => r.hasPhone && r.hasEmail)
    : results;
  const copyAllResults = async () => {
    const selection = selectedChatIds.length > 0 ? new Set(selectedChatIds) : null;
    const payload = visibleResults
      .filter((result) => result.matched)
      .filter((result) => (selection ? selection.has(result.chatId) : true))
      .map((result) => (result.output || result.todo?.notes || "").trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = payload;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    }
  };

  const matchedResults = visibleResults.filter((r) => r.matched);
  const unmatchedResults = visibleResults.filter((r) => !r.matched);

  useEffect(() => {
    setSelectedChatIds(matchedResults.map((r) => r.chatId));
  }, [open, onlyStrictContacts, results.length]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-xl border border-wa-border bg-wa-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-wa-border px-4 py-3">
          <h2 className="text-sm font-semibold text-wa-text-primary">One-Prompt Ergebnisse</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-wa-text-secondary hover:bg-wa-panel-secondary"
          >
            Schließen
          </button>
        </div>
        <div className="flex items-center justify-between border-b border-wa-border px-4 py-2 text-xs text-wa-text-secondary">
          <span>
            {loading
              ? `Analysiere Chats… (${processedCount}/${Math.max(targetCount, processedCount)})`
              : `${matchedResults.length} Treffer · ${unmatchedResults.length} ohne Treffer · ${processedCount}/${Math.max(targetCount, processedCount)} analysiert`}
          </span>
          <label className="inline-flex items-center gap-1 text-xs text-wa-text-secondary">
            <input
              type="checkbox"
              checked={onlyStrictContacts}
              onChange={(e) => setOnlyStrictContacts(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-wa-border bg-wa-input-bg text-wa-green"
            />
            Nur Email + Telefonnummer
          </label>
          <button
            type="button"
            onClick={() => setSelectedChatIds(matchedResults.map((r) => r.chatId))}
            disabled={loading || matchedResults.length === 0}
            className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-primary hover:bg-wa-panel-secondary disabled:opacity-50"
            title="Alle Treffer auswählen"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelectedChatIds([])}
            disabled={loading}
            className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-primary hover:bg-wa-panel-secondary disabled:opacity-50"
            title="Auswahl aufheben"
          >
            Unselect all
          </button>
          <button
            type="button"
            onClick={onAcceptAll}
            disabled={loading || matchedResults.length === 0}
            className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-primary hover:bg-wa-panel-secondary disabled:opacity-50"
            title="Alle Treffer als Todos übernehmen"
          >
            Alle als Todo übernehmen
          </button>
          <button
            type="button"
            onClick={copyAllResults}
            disabled={loading || matchedResults.length === 0 || selectedChatIds.length === 0}
            className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-primary hover:bg-wa-panel-secondary disabled:opacity-50"
            title="Ausgewählte Treffer als reinen One-Prompt-Output kopieren"
          >
            Auswahl kopieren
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          {!loading && results.length === 0 ? (
            <p className="text-sm text-wa-text-secondary">Keine Chats analysiert.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-wa-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-wa-panel-secondary/40 text-wa-text-secondary">
                  <tr>
                    <th className="px-2 py-2">Sel</th>
                    <th className="px-2 py-2">Chatname</th>
                    <th className="px-2 py-2">Telefonnummern</th>
                    <th className="px-2 py-2">E-Mail</th>
                    <th className="px-2 py-2">Number</th>
                    <th className="px-2 py-2">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleResults.map((result) => (
                    <tr key={result.chatId} className="border-t border-wa-border/70 align-top">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selectedChatIds.includes(result.chatId)}
                          onChange={(e) => {
                            setSelectedChatIds((prev) =>
                              e.target.checked ? Array.from(new Set([...prev, result.chatId])) : prev.filter((id) => id !== result.chatId)
                            );
                          }}
                          disabled={!result.matched}
                          className="h-3.5 w-3.5 rounded border-wa-border bg-wa-input-bg text-wa-green disabled:opacity-40"
                          title={result.matched ? "Für Kopieren auswählen" : "Nur Treffer auswählbar"}
                        />
                      </td>
                      <td className="px-2 py-2 text-wa-text-primary">
                        <div>{result.chatName}</div>
                        <div className="mt-1 text-[10px] text-wa-text-secondary">{result.reason}</div>
                      </td>
                      <td className="px-2 py-2 text-wa-text-secondary">
                        {result.phones.length > 0 ? result.phones.join(", ") : "—"}
                      </td>
                      <td className="px-2 py-2 text-wa-text-secondary">
                        {result.hasEmail ? "✅ gefunden" : "❌ fehlt"}
                        {result.emails.length > 0 && (
                          <div className="mt-1 text-[10px]">{result.emails.join(", ")}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-wa-text-secondary">
                        {result.hasPhone ? "✅ gefunden" : "❌ fehlt"}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenChat(result.chatId)}
                            className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-primary hover:bg-wa-panel-secondary"
                            title="Chat öffnen"
                          >
                            Öffnen
                          </button>
                          {result.matched && (
                            <button
                              type="button"
                              onClick={() => onAcceptOne(result)}
                              disabled={!!acceptingByChatId[result.chatId]}
                              className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-primary hover:bg-wa-panel-secondary disabled:opacity-50"
                            >
                              {acceptingByChatId[result.chatId] ? "Übernehme…" : "Als Todo"}
                            </button>
                          )}
                          {!result.matched && (
                            <button
                              type="button"
                              onClick={() => onIgnoreOne(result.chatId)}
                              className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-secondary hover:bg-wa-panel-secondary"
                            >
                              Ignorieren
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
