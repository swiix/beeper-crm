# Beeper Message & Attachment Types

Reference: [Beeper Desktop API – Messages](https://developers.beeper.com/desktop-api-reference/resources/messages).  
Checked against API responses and docs (Instagram, WhatsApp, Matrix, etc. unified via Beeper).

---

## Message-level `type`

Top-level message content type. Used to distinguish media and system messages from plain text.

| Type       | Description                    | UI in Beeper CRM                          |
|------------|--------------------------------|-------------------------------------------|
| `TEXT`     | Plain text message             | Rendered as text; optional attachments    |
| `NOTICE`   | System/notice (e.g. "X joined")| Muted, centered or compact line           |
| `IMAGE`    | Image(s)                       | Image(s) via attachments; optional text  |
| `VIDEO`    | Video (incl. Reels)            | Video player or poster + link            |
| `VOICE`    | Voice note (WhatsApp etc.)     | Playable `<audio controls>`                |
| `AUDIO`    | Audio file / voice             | Playable `<audio controls>`                |
| `FILE`     | Generic file                   | Filename + download link                  |
| `STICKER`  | Sticker                        | Rendered like small image                 |
| `LOCATION` | Location share                 | Text/label "[Standort]" or coords        |
| `REACTION` | Reaction to another message    | Shown as reaction badge (e.g. on reply)   |

If `type` is missing, treat as `TEXT` when `text` is present.

---

## Attachments

Each message can have `attachments: Attachment[]`. Attachments have:

| Field         | Type    | Notes |
|----------------|---------|--------|
| `type`        | string  | `"img"` \| `"video"` \| `"audio"` \| `"unknown"` |
| `id`          | string? | Often mxc:// URL; use with assets/serve |
| `srcURL`      | string? | Public or local URL to fetch asset       |
| `fileName`    | string? | Original filename                        |
| `fileSize`    | number? | Bytes                                   |
| `mimeType`    | string? | e.g. `image/png`, `audio/ogg`           |
| `duration`    | number? | Seconds (audio/video)                   |
| `size`        | object? | `{ width, height }` in px                |
| `posterImg`   | string? | Preview image URL for video (poster frame) |
| `isGif`       | boolean?| Animated GIF                             |
| `isSticker`   | boolean?| Sticker image                            |
| `isVoiceNote` | boolean?| Voice note (e.g. WhatsApp)               |

**Asset URL:** Use app proxy `GET /api/assets/serve?url=<mxc_or_file_url>` (see `lib/asset-url.ts` `getAssetUrl()`).

---

## Mapping to networks

- **Instagram:** Reels → `VIDEO` + attachment `type: "video"`; images, DMs; stickers.
- **WhatsApp:** Voice notes → `VOICE` or `AUDIO` + `isVoiceNote: true`; images, videos, documents → `IMAGE`/`VIDEO`/`FILE`.
- **Matrix/Beeper:** Same types; `srcURL` or `id` (mxc) for media.

---

## UI implementation summary

| Message type | Rendering |
|--------------|-----------|
| TEXT        | `text`; if attachments → images inline, others as blocks below |
| NOTICE      | Gray, small, no bubble |
| IMAGE       | Attachments with type img/image or mxc → `<img>` via proxy |
| VIDEO       | `<video controls>` or poster + link; use `posterImg` if present |
| VOICE/AUDIO | `<audio controls src={proxyUrl}>` (playable in browser) |
| FILE        | Filename + `<a href={proxyUrl} download>` |
| STICKER     | Same as image, optionally smaller max size |
| LOCATION    | Label "[Standort]" or text/coordinates |
| REACTION    | Shown on linked message when we support replies |

All media URLs must go through `getAssetUrl()` so mxc:// and file:// are loaded via `/api/assets/serve`. The proxy streams the response, so `<audio>` and `<video>` elements work for playback in the browser (WhatsApp voice notes, Instagram Reels, etc.).
