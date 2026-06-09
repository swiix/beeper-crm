"use client";

import { cn } from "@/lib/cn";

type SuggestionJumpToChatButtonProps = {
  chatId: string;
  chatName?: string;
  accountId: string | null | undefined;
  onOpenChat: (chatId: string, accountId: string) => void;
  variant?: "action" | "chip" | "triage";
  className?: string;
  disabled?: boolean;
};

/** Opens the source chat in a new tab (respects client/browser preference via parent handler). */
export function SuggestionJumpToChatButton({
  chatId,
  chatName,
  accountId,
  onOpenChat,
  variant = "action",
  className,
  disabled,
}: SuggestionJumpToChatButtonProps) {
  if (!accountId) return null;

  const label = chatName ? `Chat: ${chatName}` : "Zum Chat";
  const title = "Zum Chat springen (in neuem Tab öffnen)";

  if (variant === "chip") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenChat(chatId, accountId)}
        title={title}
        className={cn(
          "mb-1 inline-block rounded bg-wa-panel px-1.5 py-0.5 text-left text-xs text-wa-text-secondary hover:text-wa-green hover:underline",
          disabled && "pointer-events-none opacity-40",
          className
        )}
      >
        {label}
      </button>
    );
  }

  if (variant === "triage") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenChat(chatId, accountId)}
        title={`${title} (C)`}
        className={cn(
          "tg-btn-secondary w-full py-2 text-sm",
          disabled && "pointer-events-none opacity-40",
          className
        )}
      >
        Zum Chat springen
        <span className="ml-1.5 hidden text-xs opacity-70 sm:inline">C</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onOpenChat(chatId, accountId)}
      title={title}
      className={cn(
        "rounded border border-wa-border bg-transparent px-2.5 py-1.5 text-sm font-medium text-wa-text-secondary hover:bg-wa-panel hover:text-wa-green",
        disabled && "pointer-events-none opacity-40",
        className
      )}
    >
      Chat
    </button>
  );
}
