/**
 * Types for Beeper Desktop API responses (v1).
 * Aligned with developers.beeper.com/desktop-api-reference.
 */

export interface BeeperAccount {
  /** Normalized from API accountID or id */
  id: string;
  accountID?: string;
  network?: string;
  user?: { id?: string; name?: string; handle?: string; avatar?: string; fullName?: string; imgURL?: string; username?: string };
  [key: string]: unknown;
}

export interface BeeperChat {
  id: string;
  accountID?: string;
  type?: string;
  name?: string;
  image?: string;
  participants?: Array<{ id?: string; name?: string; handle?: string; avatar?: string }>;
  lastMessage?: { text?: string; timestamp?: string; senderName?: string; isSender?: boolean };
  lastActivity?: string;
  /** From Beeper API: chat is archived (hidden from main list when showArchived is off). */
  isArchived?: boolean;
  [key: string]: unknown;
}

/** Single attachment on a Beeper message (image, video, audio, file). */
export interface BeeperMessageAttachment {
  type?: string;
  id?: string;
  fileName?: string;
  mimeType?: string;
  /** mxc:// or file:// URL; use with assets/serve to display */
  srcURL?: string;
  size?: { width?: number; height?: number };
  /** Duration in seconds (audio/video) */
  duration?: number;
  fileSize?: number;
  /** Preview image URL for video (poster frame) */
  posterImg?: string;
  isGif?: boolean;
  isSticker?: boolean;
  isVoiceNote?: boolean;
}

export interface BeeperMessage {
  id: string;
  accountID?: string;
  chatID?: string;
  senderID?: string;
  sortKey?: string;
  timestamp?: string;
  text?: string;
  type?: string;
  isSender?: boolean;
  isUnread?: boolean;
  senderName?: string;
  attachments?: BeeperMessageAttachment[];
  reactions?: unknown[];
  [key: string]: unknown;
}

export interface BeeperAccountsResponse {
  items?: BeeperAccount[];
  [key: string]: unknown;
}

export interface BeeperChatsResponse {
  items?: BeeperChat[];
  nextCursor?: string;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface BeeperMessagesResponse {
  items?: BeeperMessage[];
  nextCursor?: string;
  hasMore?: boolean;
  [key: string]: unknown;
}

/** CRM contact analysis (AI) */
export interface ContactAnalysis {
  summary?: string;
  branche?: string;
  kaufkraft?: string;
  wunsch?: string;
  pain?: string;
  nextMessageSuggestions?: string[];
  stage?: string;
  /** Tinder view: priority 1–10 (1 = low, 10 = high) for processing order. */
  priorityIndex?: number;
}

/** CRM pipeline stages. New contacts start in Unzugeordnet. */
export const CRM_STAGES = ["Unzugeordnet", "Lead", "Qualified", "Offer", "Won", "Lost", "Friends"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

/** Display label for Beeper network */
export const NETWORK_LABELS: Record<string, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  signal: "Signal",
  discord: "Discord",
  slack: "Slack",
  google_messages: "Google Messages",
};

export function getNetworkLabel(network?: string): string {
  if (!network) return "Chat";
  return NETWORK_LABELS[network.toLowerCase()] ?? network;
}
