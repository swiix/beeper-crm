"use client";

type TodoSyncBadgeProps = {
  todoSyncTarget: "google" | "reclaim";
  externalGoogleTaskId?: string | null;
  externalReclaimTaskId?: string | null;
};

export function TodoSyncBadge({
  todoSyncTarget,
  externalGoogleTaskId,
  externalReclaimTaskId,
}: TodoSyncBadgeProps) {
  if (todoSyncTarget === "google" && externalGoogleTaskId) {
    return (
      <span
        className="shrink-0 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400"
        title={`Google Task ${externalGoogleTaskId}`}
      >
        G✓
      </span>
    );
  }
  if (todoSyncTarget === "reclaim" && externalReclaimTaskId) {
    return (
      <span
        className="shrink-0 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400"
        title={`Reclaim Task ${externalReclaimTaskId}`}
      >
        R✓
      </span>
    );
  }
  return null;
}
