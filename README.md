# Beeper CRM

Local CRM and todo workflow on top of [Beeper](https://www.beeper.com/) chats: analysis, Tinder-style triage, todo extraction, Google Tasks / Reclaim sync.

## Requirements

- Node.js 20+
- pnpm 10+
- Beeper Desktop (for chat API / focus)
- Optional: Google OAuth credentials, Reclaim API token

## Setup

```bash
pnpm install
cp .env.example .env   # if present; otherwise create .env manually
pnpm dev               # http://localhost:3002 (Webpack)
pnpm dev:turbo         # same port, Turbopack bundler
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `BEEPER_ACCESS_TOKEN` | Beeper API token |
| `OPENAI_API_KEY` | Chat / todo analysis |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Tasks OAuth |
| `GOOGLE_TASKS_REDIRECT_URI` | Optional; default `{origin}/api/google-tasks/callback` |
| `BEEPER_CRM_DATA_DIR` | Override data directory (recommended on Google Drive / iCloud projects) |

### Data directory

SQLite and JSON settings live outside the repo by default when the project is on a cloud-synced path:

- **macOS:** `~/Library/Application Support/beeper-crm/`
- **Otherwise:** `./data/`

Files include `beeper-crm.db` (todos, suggestion cache, analyses), `todo-settings.json`, `reclaim-settings.json`, etc.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Dev server port 3002 |
| `pnpm dev:turbo` | Dev with Turbopack |
| `pnpm build` | Production build |
| `pnpm start` | Production server port 3001 |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests (Vitest) |

## Todo sync

In **Settings → Todo → Synchronisation** choose exactly one target:

- **Google Tasks** — OAuth via G+ in the todo list
- **Reclaim** — API token in settings

Auto-sync on accept and manual ⬆︎G / ⬆︎R sync push to the selected target. Edits to synced todos are pushed to the external task on PATCH.

Todo **suggestion cache** (KI analysis) is stored in SQLite (`chat_todo_suggestions`) and survives server restarts.

## License

Private project.
