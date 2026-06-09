"use client";

import { formatAnalyzeCostUsd } from "@/lib/openai-cost";

type AnalyzeCostNotificationParams = {
  costUsd: number;
  title?: string;
  detail?: string;
};

/** Show a desktop notification with OpenAI scan cost (browser Notification API). */
export async function showAnalyzeCostNotification({
  costUsd,
  title = "Chat-Scan abgeschlossen",
  detail,
}: AnalyzeCostNotificationParams): Promise<void> {
  if (typeof window === "undefined") return;

  const costLabel = formatAnalyzeCostUsd(costUsd);
  const body = detail ? `${detail} · ${costLabel} USD` : `Kosten: ${costLabel} USD`;

  if ("Notification" in window) {
    try {
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }
      if (Notification.permission === "granted") {
        new Notification(title, { body });
        return;
      }
    } catch {
      // Fall through to console.
    }
  }

  console.info(`[analyze cost] ${title}: ${body}`);
}
