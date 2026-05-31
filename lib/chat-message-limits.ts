/** Hard cap on messages fetched/analyzed per chat across CRM, Tinder, and Todo. */
export const MAX_CHAT_MESSAGES = 50;

export const MIN_TINDER_MESSAGE_PRELOAD = 10;

export function clampChatMessageCount(value: number): number {
  return Math.max(0, Math.min(MAX_CHAT_MESSAGES, Math.round(value)));
}

export function clampTinderMessagePreloadCount(value: number): number {
  return Math.max(MIN_TINDER_MESSAGE_PRELOAD, Math.min(MAX_CHAT_MESSAGES, Math.round(value)));
}
