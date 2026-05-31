# Beeper Desktop API – actual response shapes (reverse‑engineered)

Probed with `node scripts/probe-beeper-api.mjs`. Base URL: `http://localhost:23373`, auth: `Authorization: Bearer <BEEPER_MCP_TOKEN>`.

---

## GET /v1/accounts

**Response:** Direct array (no `items` wrapper).

```json
[
  {
    "accountID": "hungryserv",
    "network": "Beeper (Matrix)",
    "user": {
      "id": "@personalcoding:beeper.com",
      "email": "dawid@personalcoding.de",
      "fullName": "Dawid Paliczuk",
      "displayText": "Dawid Paliczuk",
      "username": "personalcoding:beeper.com",
      "isSelf": true
    }
  },
  {
    "accountID": "instagramgo",
    "network": "Instagram",
    "user": {
      "id": "17842...",
      "imgURL": "file:///...",
      "fullName": "Dawid mit W | ...",
      "displayText": "...",
      "username": "personalcoding.de",
      "isSelf": true
    }
  }
]
```

- **No `id` field** – use `accountID` as the account identifier.
- **user:** `fullName`, `username`, `imgURL` (not `name`/`handle`/`avatar`).

---

## GET /v1/chats?accountIDs={accountID}

**Response:** `{ items: [...], hasMore?, oldestCursor?, newestCursor? }`.

**Paging:** Pass `cursor` (use `oldestCursor` from previous response) and `direction=before` to load the next page of older chats.

Each chat item:

| API field       | Type   | Notes                          |
|-----------------|--------|---------------------------------|
| id              | string | Chat ID                         |
| localChatID     | string |                                |
| accountID       | string |                                |
| **title**       | string | Display name (not `name`)       |
| type            | string | e.g. "group"                   |
| participants    | object | `{ items: [], hasMore, total }` |
| lastActivity    | string | ISO timestamp                  |
| unreadCount     | number |                                |
| isArchived      | boolean|                                |
| isMuted         | boolean|                                |
| isPinned        | boolean|                                |
| **preview**     | object | Last message (not `lastMessage`) |

**preview** shape:

- id, chatID, accountID, senderID, **senderName**, **timestamp**, sortKey, type, **text**, **isSender**, linkedMessageID, isUnread

So: chat display name = `title`; last message = `preview` (preview.text, preview.senderName, preview.timestamp).

---

## GET /v1/chats/{chatID}

**Response:** Single chat object (same shape as one `items[]` entry: id, accountID, title, type, participants, etc.). No wrapper.

---

## GET /v1/chats/{chatID}/messages

**Response:** `{ items: [], hasMore?, nextCursor? }`.

Each message:

- id, chatID, accountID, senderID, **senderName**, **timestamp**, sortKey, type, **text**, **isSender**, linkedMessageID?, isUnread?, reactions?

**Paging:** Pass `cursor` and `direction=before` to load older messages. Prefer `nextCursor` from the response when present. If it is missing (common for some bridges), use the **`sortKey` of the last item in `items`** (oldest message in the page). **`items` is ordered newest-first**; do **not** use `items[0].sortKey` for the next page — that points at the newest message and breaks paging (e.g. Instagram / WhatsApp).

**No filter params** – this endpoint returns all messages in the chat (paginated). For filtering, use **GET /v1/messages/search** with `chatIDs=[chatID]`.

---

## GET /v1/messages/search

Search/filter messages (optionally limited to specific chats). Use this when the chat view has active filters.

**Query parameters:**

| Parameter          | Type     | Description |
|--------------------|----------|-------------|
| **chatIDs**        | string[] | Limit to these chat IDs (e.g. current chat only). |
| **accountIDs**     | string[] | Limit to these account IDs. |
| **sender**         | string   | `"me"` (only my messages), `"others"` (only from contacts), or a specific user ID. |
| **query**          | string   | Literal word search (exact words, any order). Single words work best. |
| **mediaTypes**     | string[] | `["image"]`, `["video"]`, `["link"]`, `["file"]`, or `["any"]`. Omit = no media filter. |
| **dateAfter**      | string   | ISO 8601 – only messages after this time. |
| **dateBefore**     | string   | ISO 8601 – only messages before this time. |
| **chatType**       | string   | `"group"` or `"single"`. |
| **limit**          | number   | Max number of messages to return. |
| **direction**      | string   | `"before"` or `"after"` (pagination). |
| **cursor**         | string   | Opaque cursor from previous response (`oldestCursor` / `newestCursor`). |
| includeMuted       | boolean  | Include muted chats (default true). |
| excludeLowPriority | boolean  | Exclude low-priority (default true). |

**Response:** `{ items: Message[], hasMore?, oldestCursor?, newestCursor?, chats? }`. Same message shape as List. Use `oldestCursor` with `direction=before` for older results.

---

## POST /v1/chats/{chatID}/messages

**Body:** `{ "text": "..." }`. Response: created message object or error.

---

## GET /v1/assets/serve

**Query:** `url` – mxc://, localmxc://, or file:// URL.

Streams the file (e.g. images for message attachments, avatars). Used by the app via **GET /api/assets/serve?url=...** so the browser can load mxc/file URLs through the backend proxy.

- **Message image attachments:** `type: "IMAGE"`, `attachments[].srcURL` or `attachments[].id` (mxc://).

---

## POST /v1/focus

Opens Beeper Desktop and optionally focuses on a chat.

**Body:** `{ chatID?: string, messageID?: string, draftText?: string }`.

- **chatID** – Beeper chat ID to open and focus.
- **messageID** – (optional) Jump to this message in the chat.
- **draftText** – (optional) Pre-fill the message input.

Used by the app via **POST /api/focus** (e.g. "In Beeper öffnen" button in the chat header).
- **Account/participant avatars:** `user.imgURL` or participant `imgURL` (file:// or mxc://).
