"use client";

import { useState } from "react";
import type { BeeperAccount } from "@/lib/types";
import { getAssetUrl } from "@/lib/asset-url";

interface AccountListProps {
  accounts: BeeperAccount[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOrderChange?: (orderedIds: string[]) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const networkLabels: Record<string, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  signal: "Signal",
  discord: "Discord",
  slack: "Slack",
  google_messages: "Google Messages",
};

function networkLabel(network?: string): string {
  if (!network) return "Account";
  return networkLabels[network.toLowerCase()] ?? network;
}

const BUBBLE_SIZE = 48;

export function AccountList({
  accounts,
  selectedId,
  onSelect,
  onOrderChange,
  loading,
  error,
  onRetry,
}: AccountListProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.setData("application/x-account-id", id);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDropTargetId(null);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedId && draggedId !== id) setDropTargetId(id);
  };

  const handleDragLeave = () => {
    setDropTargetId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDropTargetId(null);
    const sourceId = e.dataTransfer.getData("application/x-account-id") || e.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId || !onOrderChange) return;
    const ids = accounts.map((a) => a.id);
    const fromIdx = ids.indexOf(sourceId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...ids];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, sourceId);
    onOrderChange(next);
    setDraggedId(null);
  };
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div
          className="flex shrink-0 items-center justify-center rounded-full bg-wa-input-bg"
          style={{ width: BUBBLE_SIZE, height: BUBBLE_SIZE }}
          title="Accounts werden geladen…"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-wa-green border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 px-2 py-4">
        <div
          className="flex shrink-0 items-center justify-center rounded-full bg-red-500/20"
          style={{ width: BUBBLE_SIZE, height: BUBBLE_SIZE }}
          title="Fehler beim Laden der Accounts"
        >
          <span className="text-lg text-red-400">!</span>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-wa-green hover:underline"
          title="Erneut versuchen"
        >
          Erneut
        </button>
      </div>
    );
  }

  if (!accounts.length) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full bg-wa-input-bg text-wa-text-secondary"
        style={{ width: BUBBLE_SIZE, height: BUBBLE_SIZE }}
        title="Keine Accounts"
      >
        <span className="text-xs">0</span>
      </div>
    );
  }

  return (
    <ul className="flex flex-col items-center gap-1 py-2 scroll-thin overflow-y-auto max-h-[calc(100vh-8rem)]">
      {accounts.map((acc) => {
        const name =
          ((acc.user as { name?: string })?.name ??
            (acc.user as { handle?: string })?.handle ??
            (acc.id ? `${acc.id.slice(0, 12)}` : "Account")) || "Account";
        const isSelected = acc.id === selectedId;
        const avatarUrl = getAssetUrl((acc.user as { avatar?: string; imgURL?: string })?.avatar ?? (acc.user as { imgURL?: string })?.imgURL);
        const network = networkLabel(acc.network).slice(0, 1);
        const isDragging = draggedId === acc.id;
        const isDropTarget = dropTargetId === acc.id;
        return (
          <li
            key={acc.id}
            draggable={!!onOrderChange}
            onDragStart={onOrderChange ? (e) => handleDragStart(e, acc.id) : undefined}
            onDragEnd={onOrderChange ? handleDragEnd : undefined}
            onDragOver={onOrderChange ? (e) => handleDragOver(e, acc.id) : undefined}
            onDragLeave={onOrderChange ? handleDragLeave : undefined}
            onDrop={onOrderChange ? (e) => handleDrop(e, acc.id) : undefined}
            className={`flex flex-col items-center transition-opacity ${isDragging ? "opacity-50" : ""} ${isDropTarget ? "ring-2 ring-wa-green ring-offset-2 ring-offset-wa-panel rounded-full" : ""}`}
            title={onOrderChange ? `${name} – Ziehen zum Umsortieren` : undefined}
          >
            <button
              type="button"
              onClick={() => onSelect(acc.id)}
              title={`${name} · ${networkLabel(acc.network)} – Klicken zum Auswählen${onOrderChange ? ", ziehen zum Umsortieren" : ""}`}
              aria-label={`Account ${name}, ${networkLabel(acc.network)}`}
              className={`flex shrink-0 items-center justify-center rounded-full transition-colors ${
                isSelected
                  ? "bg-wa-panel-secondary"
                  : "hover:bg-wa-panel-secondary/70"
              }`}
              style={{ width: BUBBLE_SIZE, height: BUBBLE_SIZE }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-full w-full rounded-full object-cover pointer-events-none"
                  draggable={false}
                />
              ) : (
                <span className="text-2xl font-semibold text-wa-text-secondary select-none">
                  {(name.trim().slice(0, 1) || network).toUpperCase()}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
