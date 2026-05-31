# Analysis cache (credits / correctness)

## Chat analysis (`/api/analyze-chat`)

- **SQLite** (`chat_analyses`): stores `last_message_sort_key` and `analysis_prompt_hash` with each save.
- **Prompt hash** ([`lib/analysis-prompt-hash.ts`](../lib/analysis-prompt-hash.ts)): SHA-256 (short) over model id, view (default/tinder), suggestion counts, and persisted prompt text from `data/prompts.json`. Changing prompts or model invalidates cache without manual purge.
- **Skip OpenAI** when `force` is false, the latest message `sortKey` matches the stored marker, and the prompt hash matches.
- **In-flight dedup** ([`lib/analysis-inflight.ts`](../lib/analysis-inflight.ts)): parallel POSTs for the same `chatId` + view share one OpenAI run.
- **RAM** (`lib/cache.ts`): still used as a fast layer; SQLite is the source of truth for smart cache after restarts.

## Todo analysis (`/api/todo-list/analyze`)

- **SQLite** (`chat_todo_suggestions.todo_prompt_hash`): hash of system prompt, scan mode, limits, and attachment mode ([`lib/todo-prompt-hash.ts`](../lib/todo-prompt-hash.ts)).
- **Skip** when last message sort key matches **and** todo prompt hash matches (in addition to existing marker logic).

## Environment

- `OPENAI_ANALYSIS_MODEL` / `OPENAI_TODO_MODEL` default to `gpt-4o-mini`; changing them changes the hash and invalidates existing rows until the next successful analysis.
