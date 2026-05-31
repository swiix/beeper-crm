"use client";

import { useState, useEffect, useCallback } from "react";
import type { BeeperAccount, BeeperChat } from "@/lib/types";
import type { ContactAnalysis } from "@/lib/types";
import { getNetworkLabel, CRM_STAGES } from "@/lib/types";
import { getAssetUrl } from "@/lib/asset-url";
import {
  getContactByChatId,
  getContacts,
  createContact,
  addChatToContact,
  updateContact,
} from "@/lib/contacts";
import type { CrmContact } from "@/lib/contacts";

const MIN_SEARCH_LENGTH = 2;

/** Fuzzy match: all characters of query appear in text in order (case-insensitive). */
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase();
  const t = (text ?? "").toLowerCase();
  if (!q) return true;
  let j = 0;
  for (let i = 0; i < q.length; i++) {
    const idx = t.indexOf(q[i], j);
    if (idx === -1) return false;
    j = idx + 1;
  }
  return true;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

interface ContactCrmPanelProps {
  chat: BeeperChat | null;
  accounts: BeeperAccount[];
  analysis: ContactAnalysis | null;
  analyzing?: boolean;
  /** Current analysis phase (e.g. "Lade Nachrichten…") for status display. */
  analysisStep?: string | null;
  analysisError?: string | null;
  canAnalyze?: boolean;
  onAnalyze: () => void;
  /** Cancel ongoing single-chat analysis (already-created analysis is kept). */
  onCancelAnalyze?: () => void;
  onOpenInCrm?: () => void;
  /** When user clicks a suggestion in the panel, insert it into the message input */
  onSuggestionClick?: (text: string) => void;
  /** When user Shift+clicks a suggestion, send it immediately. Optional; if not set, Shift+Click is no-op. */
  onSuggestionSend?: (text: string) => void;
  /** When true, Shift+Click (send) is disabled (e.g. while messages are loading). */
  sendDisabled?: boolean;
  /** From current chat messages: last time I sent, last time they sent */
  lastContactedByMeAt?: string | null;
  lastContactedByThemAt?: string | null;
  /** Called after chat archive state was toggled (so parent can refresh list and update selectedChat). */
  onArchiveChat?: (archived: boolean) => void;
  /** Follow-up count for this chat (consecutive messages from me without reply). Same badge as in ChatList. */
  followUpCount?: number;
}

export function ContactCrmPanel({
  chat,
  accounts,
  analysis,
  analyzing = false,
  analysisStep = null,
  analysisError = null,
  canAnalyze = true,
  onAnalyze,
  onCancelAnalyze,
  onOpenInCrm,
  onSuggestionClick,
  onSuggestionSend,
  sendDisabled = false,
  lastContactedByMeAt,
  lastContactedByThemAt,
  followUpCount = 0,
  onArchiveChat,
}: ContactCrmPanelProps) {
  const width = 360;
  const [contact, setContact] = useState<CrmContact | null>(null);
  const [addChatModalOpen, setAddChatModalOpen] = useState(false);
  /** Account id for assign-modal: "" = all accounts, otherwise single account. */
  const [addChatModalAccountId, setAddChatModalAccountId] = useState("");
  const [addChatSearchQuery, setAddChatSearchQuery] = useState("");
  const [addToContactId, setAddToContactId] = useState<string | null>(null);
  const [allChatsForModal, setAllChatsForModal] = useState<BeeperChat[]>([]);
  const [loadingModalChats, setLoadingModalChats] = useState(false);
  const [modalAccounts, setModalAccounts] = useState<BeeperAccount[]>([]);
  const [archivingChat, setArchivingChat] = useState(false);

  useEffect(() => {
    setContact(chat ? getContactByChatId(chat.id) : null);
  }, [chat?.id]);

  const accountById = (id: string) => accounts.find((a) => a.id === id);
  const networkForChat = (c: BeeperChat) =>
    (accountById(c.accountID ?? "") as BeeperAccount)?.network;

  const handleCreateContact = () => {
    if (!chat?.id || !chat.accountID) return;
    const acc = accountById(chat.accountID) as BeeperAccount | undefined;
    const name = (chat.name || "Unbenannt").trim();
    const created = createContact(name, chat.id, chat.accountID, acc?.network);
    setContact(created);
  };

  const handleAddToExistingContact = (contactId: string) => {
    if (!chat?.id || !chat.accountID) return;
    const acc = accountById(chat.accountID) as BeeperAccount | undefined;
    const updated = addChatToContact(contactId, chat.id, chat.accountID, acc?.network);
    if (updated) setContact(updated);
    setAddToContactId(null);
  };

  /** Load all pages of chats for one account. */
  const fetchAllChatsForAccount = useCallback(async (accountId: string): Promise<BeeperChat[]> => {
    const chats: BeeperChat[] = [];
    let cursor: string | null = null;
    let hasMore = true;
    while (hasMore) {
      const url: string = cursor
        ? `/api/chats?accountIDs=${encodeURIComponent(accountId)}&cursor=${encodeURIComponent(cursor)}&direction=before`
        : `/api/chats?accountIDs=${encodeURIComponent(accountId)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) return chats;
      const items = (data.items ?? []) as BeeperChat[];
      items.forEach((c) => chats.push({ ...c, accountID: c.accountID ?? accountId }));
      hasMore = !!data.hasMore && !!data.oldestCursor;
      cursor = data.oldestCursor ?? null;
    }
    return chats;
  }, []);

  const loadModalChats = useCallback(
    async (accountIdOrAll: string, accountList: BeeperAccount[]) => {
      const ids = accountIdOrAll ? [accountIdOrAll] : accountList.map((a) => a.id).filter(Boolean);
      const allChats: BeeperChat[] = [];
      await Promise.all(
        ids.map(async (id) => {
          const list = await fetchAllChatsForAccount(id);
          allChats.push(...list);
        })
      );
      setAllChatsForModal(allChats);
    },
    [fetchAllChatsForAccount]
  );

  const openAddChatModal = useCallback(() => {
    setAddChatModalOpen(true);
    setAddChatSearchQuery("");
    setAllChatsForModal([]);
    const defaultAccountId = chat?.accountID ?? "";
    setAddChatModalAccountId(defaultAccountId);
    setLoadingModalChats(true);
    setModalAccounts([]);
    (async () => {
      try {
        const accountsRes = await fetch("/api/accounts");
        const accountsData = await accountsRes.json();
        const rawList = Array.isArray(accountsData)
          ? accountsData
          : (accountsData as { items?: unknown[] })?.items ?? [];
        const normalized: BeeperAccount[] = (rawList as Record<string, unknown>[]).map((a) => {
          const id = (a.accountID ?? a.id ?? "") as string;
          return { ...a, id, accountID: id } as BeeperAccount;
        }).filter((a) => a.id.length > 0);
        setModalAccounts(normalized);
        await loadModalChats(defaultAccountId || "", normalized);
      } finally {
        setLoadingModalChats(false);
      }
    })();
  }, [chat?.accountID, loadModalChats]);

  const assignedChatIds = new Set(contact?.chats.map((ch) => ch.chatId) ?? []);
  const availableChatsForContact = allChatsForModal.filter(
    (c) => !assignedChatIds.has(c.id)
  );
  const addChatSearchTrimmed = addChatSearchQuery.trim();
  const addChatSearchActive = addChatSearchTrimmed.length >= MIN_SEARCH_LENGTH;
  const filteredChatsForAssign = addChatSearchActive
    ? availableChatsForContact.filter((c) =>
        fuzzyMatch(addChatSearchTrimmed, c.name ?? "")
      )
    : availableChatsForContact;

  const handleArchiveChat = async () => {
    if (!chat?.id) return;
    const nextArchived = !chat.isArchived;
    setArchivingChat(true);
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chat.id)}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: nextArchived }),
      });
      if (res.ok) {
        onArchiveChat?.(nextArchived);
      }
    } finally {
      setArchivingChat(false);
    }
  };

  const handleAddChatToContact = (chatId: string, accountId: string, network?: string) => {
    if (!contact?.id) return;
    const updated = addChatToContact(contact.id, chatId, accountId, network);
    if (updated) setContact(updated);
    setAddChatModalOpen(false);
  };

  const handleModalAccountChange = useCallback(
    (newAccountId: string) => {
      setAddChatModalAccountId(newAccountId);
      if (modalAccounts.length === 0) return;
      setLoadingModalChats(true);
      loadModalChats(newAccountId, modalAccounts).finally(() =>
        setLoadingModalChats(false)
      );
    },
    [modalAccounts, loadModalChats]
  );

  const contactsList = getContacts();

  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col border-l border-wa-border bg-wa-panel"
      style={{ width }}
    >
      <header className="flex h-14 shrink-0 items-center border-b border-wa-border px-4">
        <span className="text-sm font-medium text-wa-text-secondary">
          Kontakt & CRM
        </span>
      </header>
      <div className="flex-1 overflow-y-auto scroll-thin p-4 pb-10">
        {!chat ? (
          <p className="text-sm text-wa-text-secondary">
            Wähle einen Chat, um Kontaktanalyse und CRM-Vorschläge zu sehen.
          </p>
        ) : (
          <>
            <div className="mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-wa-input-bg">
                  {getAssetUrl(chat.image) ? (
                    <img
                      src={getAssetUrl(chat.image)!}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-lg text-wa-text-secondary">
                      {(chat.name || chat.id).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-wa-text-primary">
                    {chat.name || "Chat"}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-xs text-wa-text-secondary">
                      {getNetworkLabel(networkForChat(chat))} · Instagram Akquise
                    </p>
                    {followUpCount >= 1 && (
                      <span
                        className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"
                        title={`${followUpCount} Follow-up(s) ohne Antwort`}
                      >
                        ({followUpCount} FUP{followUpCount !== 1 ? "s" : ""})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Pinned at top of scroll area: quick-reply suggestions (when analysis exists) */}
            {analysis && (
              <section className="sticky top-0 z-10 -mx-4 mb-4 border-b border-wa-border bg-wa-panel/95 px-4 pb-3 pt-1 shadow-sm backdrop-blur-sm">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                  Nächste Nachricht (Vorschläge)
                </h3>
                <ul className="space-y-2">
                  {(analysis.nextMessageSuggestions ?? []).map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={(e) => {
                          const trimmed = s.trim();
                          if (!trimmed) return;
                          if (e.shiftKey) {
                            if (!sendDisabled) onSuggestionSend?.(trimmed);
                          } else {
                            onSuggestionClick?.(trimmed);
                          }
                        }}
                        title="Klicken: in Eingabe übernehmen · Shift+Klick: sofort senden"
                        className="w-full rounded-lg border border-wa-border bg-wa-panel-secondary/50 p-2.5 text-left text-sm text-wa-text-primary transition-colors hover:border-wa-green hover:bg-wa-green/10"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-wa-text-secondary">
                  Klick = übernehmen · Shift+Klick = sofort senden
                </p>
              </section>
            )}

            {/* Last contact (this chat from loaded messages, or contact-level) */}
            <section className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                  Letzter Kontakt
                </h3>
                <div className="space-y-1.5 rounded-lg bg-wa-panel-secondary/50 p-3 text-sm">
                  <p className="text-wa-text-primary">
                    <span className="text-wa-text-secondary">Du hast zuletzt geschrieben:</span>{" "}
                    {formatDateTime(lastContactedByMeAt ?? contact?.lastContactedByMeAt)}
                  </p>
                  <p className="text-wa-text-primary">
                    <span className="text-wa-text-secondary">Kontakt hat zuletzt geschrieben:</span>{" "}
                    {formatDateTime(lastContactedByThemAt ?? contact?.lastContactedByThemAt)}
                  </p>
                </div>
              </section>

            {/* Contact assignment */}
            <section className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                Kontakt zuweisen
              </h3>
              {contact ? (
                <div className="space-y-2 rounded-lg bg-wa-panel-secondary/50 p-3 text-sm">
                  <p className="text-wa-text-primary">
                    Gehört zu: <strong>{contact.displayName || "Unbenannt"}</strong>
                  </p>
                  {contact.chats.length > 1 && (
                    <p className="text-xs text-wa-text-secondary">
                      Kanäle:{" "}
                      {contact.chats
                        .map((ch) => getNetworkLabel(ch.network))
                        .join(", ")}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={openAddChatModal}
                    title="Weiteren Kanal (z. B. WhatsApp) zu diesem Kontakt zuweisen"
                    className="w-full rounded-lg border border-wa-green py-2 text-sm font-medium text-wa-green transition-colors hover:bg-wa-green/10"
                  >
                    Weiteren Chat zuweisen (z. B. WhatsApp)
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleCreateContact}
                    title="Diesen Chat als neuen CRM-Kontakt anlegen"
                    className="w-full rounded-lg bg-wa-green py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  >
                    Als neuen Kontakt anlegen
                  </button>
                  {contactsList.length > 0 && (
                    <>
                      <p className="text-xs text-wa-text-secondary">
                        Oder zu bestehendem Kontakt:
                      </p>
                      {!addToContactId ? (
                        <select
                          className="w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary"
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) setAddToContactId(v);
                          }}
                          title="Bestehenden Kontakt auswählen, dem dieser Chat zugeordnet werden soll"
                        >
                          <option value="">Kontakt wählen…</option>
                          {contactsList.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.displayName || "Unbenannt"}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleAddToExistingContact(addToContactId)}
                            title="Chat dem gewählten Kontakt zuweisen"
                            className="flex-1 rounded-lg border border-wa-green py-2 text-sm font-medium text-wa-green hover:bg-wa-green/10"
                          >
                            Hinzufügen
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddToContactId(null)}
                            title="Auswahl abbrechen"
                            className="rounded-lg border border-wa-border py-2 px-3 text-sm text-wa-text-secondary hover:bg-wa-panel-secondary"
                          >
                            Abbrechen
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>

            {chat && (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={handleArchiveChat}
                  disabled={archivingChat}
                  title={chat.isArchived ? "Chat aus dem Archiv holen" : "Chat archivieren (in der Liste ausblenden, mit Filter wieder anzeigbar)"}
                  className="w-full rounded-lg border border-wa-border py-2 text-sm font-medium text-wa-text-secondary transition-colors hover:bg-wa-panel-secondary disabled:opacity-50"
                >
                  {archivingChat
                    ? "…"
                    : chat.isArchived
                      ? "Aus Archiv holen"
                      : "Chat archivieren"}
                </button>
              </div>
            )}

            {onOpenInCrm && (
              <button
                type="button"
                onClick={onOpenInCrm}
                title="Diesen Chat in der CRM-Pipeline anzeigen"
                className="mb-4 w-full rounded-lg border border-wa-green py-2 text-sm font-medium text-wa-green transition-colors hover:bg-wa-green/10"
              >
                Im CRM anzeigen
              </button>
            )}

            {contact && (
              <section className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                  CRM-Stage
                </h3>
                <select
                  value={contact.stage ?? "Unzugeordnet"}
                  onChange={(e) => {
                    const stage = e.target.value;
                    const updated = updateContact(contact.id, { stage });
                    if (updated) setContact(updated);
                  }}
                  title="CRM-Stage des Kontakts ändern"
                  className="w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
                >
                  {CRM_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </section>
            )}

            {!analysis ? (
              <div className="space-y-3">
                <p className="text-sm text-wa-text-secondary">
                  Chat mit KI analysieren: Branche, Kaufkraft, Wunsch, Pain und
                  Harmonzi-Style Antwortvorschläge.
                </p>
                {analysisError && (
                  <p className="text-sm text-red-400">{analysisError}</p>
                )}
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onAnalyze}
                      disabled={analyzing || !canAnalyze}
                      title="Chat mit KI analysieren (Branche, Kaufkraft, Wunsch, Pain, Antwortvorschläge)"
                      className="rounded-lg bg-wa-green py-2.5 px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {analyzing ? "Analysiere…" : "Analyse starten"}
                    </button>
                    {analyzing && onCancelAnalyze && (
                      <button
                        type="button"
                        onClick={onCancelAnalyze}
                        title="Analyse abbrechen (bereits erstellte Analyse bleibt erhalten)"
                        className="rounded-lg border border-wa-border bg-wa-panel-secondary py-2.5 px-4 text-sm font-medium text-wa-text-primary transition-colors hover:bg-wa-panel"
                      >
                        Abbrechen
                      </button>
                    )}
                  </div>
                  {analyzing && analysisStep && (
                    <p className="text-xs text-wa-text-secondary">
                      Analysiere {chat?.name ?? "Chat"}: {analysisStep}
                    </p>
                  )}
                </div>
                {!canAnalyze && (
                  <p className="text-xs text-wa-text-secondary">
                    Wähle einen Chat, um die Analyse zu starten.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {analysis.summary && (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                      Zusammenfassung
                    </h3>
                    <p className="rounded-lg bg-wa-panel-secondary/50 p-3 text-sm text-wa-text-primary">
                      {analysis.summary}
                    </p>
                  </section>
                )}
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                    Analyse
                  </h3>
                  <ul className="space-y-2 rounded-lg bg-wa-panel-secondary/50 p-3 text-sm">
                    <li>
                      <span className="text-wa-text-secondary">Branche:</span>{" "}
                      {analysis.branche ?? "—"}
                    </li>
                    <li>
                      <span className="text-wa-text-secondary">Kaufkraft:</span>{" "}
                      {analysis.kaufkraft != null
                        ? /^(10|[1-9])$/.test(String(analysis.kaufkraft).trim())
                          ? `${String(analysis.kaufkraft).trim()}/10`
                          : analysis.kaufkraft
                        : "—"}
                    </li>
                    <li>
                      <span className="text-wa-text-secondary">Wunsch:</span>{" "}
                      {analysis.wunsch ?? "—"}
                    </li>
                    <li>
                      <span className="text-wa-text-secondary">Pain:</span>{" "}
                      {analysis.pain ?? "—"}
                    </li>
                    <li>
                      <span className="text-wa-text-secondary">Stage:</span>{" "}
                      {analysis.stage ?? "—"}
                    </li>
                  </ul>
                </section>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal: Add another chat to contact */}
      {addChatModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAddChatModalOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md rounded-lg bg-wa-panel shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-wa-border p-4">
              <h3 className="font-medium text-wa-text-primary">
                Weiteren Chat zuweisen
              </h3>
              <button
                type="button"
                onClick={() => setAddChatModalOpen(false)}
                title="Schließen"
                aria-label="Schließen"
                className="text-wa-text-secondary hover:text-wa-text-primary"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 border-b border-wa-border px-4 pb-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-wa-text-secondary">
                  Account
                </label>
                <select
                  value={addChatModalAccountId}
                  onChange={(e) => handleModalAccountChange(e.target.value)}
                  disabled={loadingModalChats || modalAccounts.length === 0}
                  title="Account auswählen, dessen Chats durchsucht werden"
                  className="w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none disabled:opacity-50"
                >
                  <option value="">Alle Accounts</option>
                  {modalAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.user?.name ?? acc.user?.handle ?? acc.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-wa-text-secondary">
                  Chat suchen
                </label>
                <input
                  type="search"
                  value={addChatSearchQuery}
                  onChange={(e) => setAddChatSearchQuery(e.target.value)}
                  placeholder="Mind. 2 Zeichen (Fuzzy-Suche im Chatnamen)"
                  title="Mind. 2 Zeichen – durchsucht Chat-/Kontaktnamen"
                  className="w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none"
                />
                {addChatSearchTrimmed.length > 0 && addChatSearchTrimmed.length < MIN_SEARCH_LENGTH && (
                  <p className="mt-1 text-xs text-wa-text-secondary">
                    Noch {MIN_SEARCH_LENGTH - addChatSearchTrimmed.length} Zeichen für die Suche
                  </p>
                )}
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto scroll-thin p-4">
              {loadingModalChats ? (
                <p className="text-sm text-wa-text-secondary">Lade Chats…</p>
              ) : availableChatsForContact.length === 0 ? (
                <p className="text-sm text-wa-text-secondary">
                  {allChatsForModal.length === 0
                    ? "Keine Chats geladen. Anderen Account wählen oder später erneut versuchen."
                    : "Alle geladenen Chats sind diesem Kontakt bereits zugeordnet."}
                </p>
              ) : !addChatSearchActive ? (
                <p className="mb-2 text-sm text-wa-text-secondary">
                  Alle {availableChatsForContact.length} Chats. Mind. 2 Zeichen eingeben zum Filtern.
                </p>
              ) : null}
              {!loadingModalChats && availableChatsForContact.length > 0 && (
                addChatSearchActive && filteredChatsForAssign.length === 0 ? (
                  <p className="text-sm text-wa-text-secondary">
                    Keine Treffer für „{addChatSearchTrimmed}“. Andere Suchbegriffe versuchen.
                  </p>
                ) : (
                <ul className="space-y-2">
                  {filteredChatsForAssign.map((c) => {
                    const net = networkForChat(c);
                    const accId = c.accountID ?? "";
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() =>
                            handleAddChatToContact(c.id, accId, net)
                          }
                          title={`Chat „${c.name || "Unbenannt"}“ (${getNetworkLabel(net)}) diesem Kontakt zuweisen`}
                          className="w-full rounded-lg border border-wa-border bg-wa-panel-secondary/50 p-3 text-left text-sm transition-colors hover:border-wa-green hover:bg-wa-green/10"
                        >
                          <span className="font-medium text-wa-text-primary">
                            {c.name || "Unbenannt"}
                          </span>
                          <span className="ml-2 text-xs text-wa-text-secondary">
                            {getNetworkLabel(net)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
