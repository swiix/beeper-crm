# Chat & CRM – event-driven updates (no polling)

We avoid a permanent polling loop. Updates run only when something relevant happens.

---

## When we invalidate / refetch

| Event | What we do |
|--------|------------|
| **User sends a message** | Server: invalidate `messages:${chatId}:*` and `chats:*`. Client: `mutateChats()`, `loadMessages(false)`, update contact `lastContactedByMeAt`. |
| **User opens a chat / loads messages** | `loadMessages()` runs; from the loaded messages we update contact `lastContactedByMeAt` / `lastContactedByThemAt` (and persist via `updateContact`). |
| **User switches account** | SWR key for chats changes → chats refetch automatically. |
| **User creates contact from unassigned chat (CRM)** | Local: `createContact` + `refreshContacts()` (no API). |
| **User moves contact to another stage (CRM)** | Local: `updateContact(..., { stage })` + `refreshContacts()`. |
| **User runs AI analyse (Chat panel)** | `setContactAnalysis(data)`; optional `updateContact(..., { stage })` if API returns stage. **`dispatchCrmAnalysisUpdated()`** → AppLayout invalidates SWR keys `crm:analysis*` and fires `contacts-synced` so Pipeline/Detail stay in sync with SQLite. |
| **Tinder batch analysis** | Same event after each successful `runAnalyzeForChats` batch. |

---

## What we do **not** do

- No interval/timer that refetches chats or messages.
- No `revalidateOnFocus` (SWR) by default, to avoid refetch on every tab switch.

---

## Optional future triggers (without adding a loop)

- **Tab focus**: enable `revalidateOnFocus: true` only for the chats SWR key if you want “refresh when returning to tab”.
- **Visibility change**: one-time revalidate when document becomes visible again (e.g. after 5 min hidden).
- **WebSocket / push**: if Beeper ever exposes real-time events, subscribe and then call `mutateChats()` or `loadMessages(false)` only when an event arrives.
