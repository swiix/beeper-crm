/** Client app views (URL path segments, not ?view= query). */

export type AppView = "chat" | "crm" | "kpi" | "tinder" | "todo" | "settings";

const APP_VIEWS: AppView[] = ["chat", "crm", "kpi", "tinder", "todo", "settings"];

export function isAppView(value: string): value is AppView {
  return (APP_VIEWS as string[]).includes(value);
}

/** First path segment → view; `/`, `/chat`, unknown → chat. */
export function viewFromPathname(pathname: string): AppView {
  const segment = pathname.replace(/\/$/, "").split("/").filter(Boolean)[0];
  if (segment && isAppView(segment)) return segment;
  return "chat";
}

export function pathForView(view: AppView): string {
  return `/${view}`;
}

export type BuildAppUrlOptions = {
  view: AppView;
  accountId?: string | null;
  chatId?: string | null;
  contactId?: string | null;
  tab?: string | null;
  extra?: Record<string, string | undefined | null>;
};

/** Build in-app path + query (no origin). */
export function buildAppUrl({
  view,
  accountId,
  chatId,
  contactId,
  tab,
  extra,
}: BuildAppUrlOptions): string {
  const params = new URLSearchParams();
  if (view === "chat") {
    if (accountId?.trim()) params.set("account", accountId.trim());
    if (chatId?.trim()) params.set("chat", chatId.trim());
  }
  if (view === "crm" && contactId?.trim()) {
    params.set("contact", contactId.trim());
  }
  if (view === "settings") {
    if (tab && tab !== "general") params.set("tab", tab);
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value != null && String(value).trim()) params.set(key, String(value).trim());
    }
  }
  const q = params.toString();
  return q ? `${pathForView(view)}?${q}` : pathForView(view);
}
