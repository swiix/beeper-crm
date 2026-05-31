"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { getContacts, type CrmContact } from "@/lib/contacts";
import { CRM_STAGES, type CrmStage } from "@/lib/types";
import { SWR_CONFIG } from "@/lib/swr-config";

type LastActivityMap = Record<
  string,
  { lastFromMe: string | null; lastFromThem: string | null; followUpCount?: number }
>;

interface KpiBoardViewProps {
  onOpenChat: (chatId: string, accountId: string) => void;
  onOpenCrmContact: (contactId: string) => void;
  onFollowUpMode: () => void;
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / (24 * 60 * 60 * 1000);
}

export function KpiBoardView({ onOpenChat, onOpenCrmContact, onFollowUpMode }: KpiBoardViewProps) {
  const [contacts, setContacts] = useState<CrmContact[]>([]);

  const refreshContacts = useCallback(() => {
    setContacts(getContacts());
  }, []);

  useEffect(() => {
    refreshContacts();
    const onSync = () => refreshContacts();
    window.addEventListener("contacts-synced", onSync);
    return () => window.removeEventListener("contacts-synced", onSync);
  }, [refreshContacts]);

  const chatIds = useMemo(
    () => [...new Set(contacts.flatMap((c) => c.chats.map((ch) => ch.chatId)))].slice(0, 200),
    [contacts]
  );

  const { data: lastActivity } = useSWR<LastActivityMap>(
    chatIds.length > 0 ? `kpi:last-activity:${chatIds.sort().join(",")}` : null,
    () =>
      fetch(`/api/crm/last-activity?chatIds=${encodeURIComponent(chatIds.join(","))}`).then((r) =>
        r.json()
      ),
    { ...SWR_CONFIG, revalidateOnFocus: false }
  );

  const stageCounts = useMemo(() => {
    const base = CRM_STAGES.reduce(
      (acc, stage) => {
        acc[stage] = 0;
        return acc;
      },
      {} as Record<CrmStage, number>
    );
    for (const c of contacts) {
      const stage = (c.stage ?? "Unzugeordnet") as CrmStage;
      if (stage in base) base[stage] += 1;
    }
    return base;
  }, [contacts]);

  const followUpQueue = useMemo(() => {
    const activity = lastActivity ?? {};
    const rows = contacts
      .map((contact) => {
        const best = contact.chats
          .map((ch) => ({ ch, act: activity[ch.chatId] }))
          .filter((x) => x.act)
          .sort((a, b) => (b.act?.followUpCount ?? 0) - (a.act?.followUpCount ?? 0))[0];
        if (!best || (best.act?.followUpCount ?? 0) <= 0) return null;
        const lastFromMeDays = daysSince(best.act?.lastFromMe);
        return {
          contact,
          chatId: best.ch.chatId,
          accountId: best.ch.accountId,
          followUps: best.act?.followUpCount ?? 0,
          lastFromMeDays,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => {
        if (b.followUps !== a.followUps) return b.followUps - a.followUps;
        return (b.lastFromMeDays ?? 0) - (a.lastFromMeDays ?? 0);
      });
    return rows.slice(0, 12);
  }, [contacts, lastActivity]);

  const waitingForReplyCount = useMemo(() => {
    const activity = lastActivity ?? {};
    let count = 0;
    for (const c of contacts) {
      const hasWaiting = c.chats.some((ch) => {
        const act = activity[ch.chatId];
        if (!act?.lastFromMe) return false;
        if (!act.lastFromThem) return true;
        return new Date(act.lastFromMe) > new Date(act.lastFromThem);
      });
      if (hasWaiting) count += 1;
    }
    return count;
  }, [contacts, lastActivity]);

  const total = contacts.length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-wa-chat-bg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-wa-text-primary">KPI Board</h1>
          <p className="mt-1 text-sm text-wa-text-secondary">Pipeline-Ueberblick und schnelle Follow-up-Aktionen.</p>
        </div>
        <button
          type="button"
          onClick={onFollowUpMode}
          className="rounded-lg border border-wa-green bg-wa-green/10 px-3 py-2 text-sm font-medium text-wa-green transition-colors hover:bg-wa-green/20"
          title="VA/FOLLOW-UP Modus aktivieren und in CRM wechseln"
        >
          VA / Follow-up mode
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-wa-border bg-wa-panel p-3">
          <p className="text-xs text-wa-text-secondary">Kontakte gesamt</p>
          <p className="mt-1 text-2xl font-semibold text-wa-text-primary">{total}</p>
        </div>
        <div className="rounded-lg border border-wa-border bg-wa-panel p-3">
          <p className="text-xs text-wa-text-secondary">Qualified + Offer</p>
          <p className="mt-1 text-2xl font-semibold text-wa-text-primary">
            {stageCounts.Qualified + stageCounts.Offer}
          </p>
        </div>
        <div className="rounded-lg border border-wa-border bg-wa-panel p-3">
          <p className="text-xs text-wa-text-secondary">Warten auf Antwort</p>
          <p className="mt-1 text-2xl font-semibold text-wa-text-primary">{waitingForReplyCount}</p>
        </div>
        <div className="rounded-lg border border-wa-border bg-wa-panel p-3">
          <p className="text-xs text-wa-text-secondary">Offene Follow-ups</p>
          <p className="mt-1 text-2xl font-semibold text-wa-text-primary">{followUpQueue.length}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <section className="rounded-lg border border-wa-border bg-wa-panel p-3">
          <h2 className="text-sm font-medium text-wa-text-primary">Pipeline nach Stage</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CRM_STAGES.map((stage) => (
              <div key={stage} className="rounded border border-wa-border bg-wa-panel-secondary/50 px-3 py-2">
                <p className="text-xs text-wa-text-secondary">{stage}</p>
                <p className="text-lg font-semibold text-wa-text-primary">{stageCounts[stage]}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-wa-border bg-wa-panel p-3">
          <h2 className="text-sm font-medium text-wa-text-primary">Priorisierte Follow-ups</h2>
          {followUpQueue.length === 0 ? (
            <p className="mt-3 text-sm text-wa-text-secondary">Aktuell keine offenen Follow-ups erkannt.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {followUpQueue.map((row) => (
                <li
                  key={`${row.contact.id}:${row.chatId}`}
                  className="flex flex-wrap items-center gap-2 rounded border border-wa-border bg-wa-panel-secondary/50 px-2.5 py-2"
                >
                  <button
                    type="button"
                    onClick={() => onOpenCrmContact(row.contact.id)}
                    className="text-left text-sm font-medium text-wa-text-primary hover:text-wa-green"
                    title="Kontakt in CRM oeffnen"
                  >
                    {row.contact.displayName || "Unbenannt"}
                  </button>
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                    {row.followUps} FUP
                  </span>
                  <span className="text-xs text-wa-text-secondary">
                    {row.lastFromMeDays != null ? `letzte Nachricht vor ${Math.max(1, Math.round(row.lastFromMeDays))} Tagen` : "kein Datum"}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenChat(row.chatId, row.accountId)}
                    className="ml-auto rounded border border-wa-border px-2 py-1 text-xs text-wa-text-primary hover:border-wa-green hover:text-wa-green"
                    title="Chat in der App oeffnen"
                  >
                    Chat oeffnen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
