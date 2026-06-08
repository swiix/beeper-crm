/**
 * SQLite database for persistent storage. Used for chat analyses and tinder priorities.
 */

import Database from "better-sqlite3";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

let db: Database.Database | null = null;

function getDbPath(): string {
  return path.join(ensureProjectDataDir(), "beeper-crm.db");
}

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_analyses (
      chat_id TEXT NOT NULL,
      view TEXT NOT NULL DEFAULT 'default',
      summary TEXT,
      branche TEXT,
      kaufkraft TEXT,
      wunsch TEXT,
      pain TEXT,
      stage TEXT,
      next_message_suggestions TEXT,
      priority_index INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, view)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_analyses_view_updated ON chat_analyses (view, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_todo_suggestions (
      chat_id TEXT NOT NULL PRIMARY KEY,
      last_message_date TEXT NOT NULL,
      todos_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todo_ignored_chats (
      chat_id TEXT NOT NULL PRIMARY KEY,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todo_pinned_chats (
      chat_id TEXT NOT NULL PRIMARY KEY,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todo_lists (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      due_date TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      priority INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      list_id TEXT,
      source_chat_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (list_id) REFERENCES todo_lists(id)
    );
    CREATE INDEX IF NOT EXISTS idx_todos_list_archived ON todos (list_id, archived);
    CREATE INDEX IF NOT EXISTS idx_todos_source_chat ON todos (source_chat_id) WHERE source_chat_id IS NOT NULL AND completed = 0 AND archived = 0;

    CREATE TABLE IF NOT EXISTS openai_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      chat_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_openai_usage_events_created_at ON openai_usage_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_openai_usage_events_category_created_at ON openai_usage_events (category, created_at DESC);

    CREATE TABLE IF NOT EXISTS google_tasks_auth (
      id TEXT NOT NULL PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      scope TEXT,
      token_type TEXT,
      expiry_date INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS google_oauth_state (
      state TEXT NOT NULL PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
  `);
  try {
    database.exec("ALTER TABLE todos ADD COLUMN source_chat_name TEXT");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN source_account_id TEXT");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN reminder_at INTEGER");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN snoozed INTEGER");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN pinned INTEGER");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE chat_todo_suggestions ADD COLUMN last_message_sort_key TEXT");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE chat_todo_suggestions ADD COLUMN last_analyzed_sort_key TEXT");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN estimated_time_minutes INTEGER");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE chat_analyses ADD COLUMN last_message_sort_key TEXT");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE chat_analyses ADD COLUMN analysis_prompt_hash TEXT");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE chat_todo_suggestions ADD COLUMN todo_prompt_hash TEXT");
  } catch {
    // column may already exist
  }
  try {
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_chat_todo_suggestions_updated ON chat_todo_suggestions (updated_at DESC)"
    );
  } catch {
    // index may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN external_google_task_id TEXT");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN google_sync_at INTEGER");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN due_at INTEGER");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN external_reclaim_task_id TEXT");
  } catch {
    // column may already exist
  }
  try {
    database.exec("ALTER TABLE todos ADD COLUMN reclaim_sync_at INTEGER");
  } catch {
    // column may already exist
  }
  try {
    const rows = database
      .prepare("SELECT id, due_date FROM todos WHERE due_date IS NOT NULL AND due_at IS NULL")
      .all() as { id: string; due_date: string }[];
    const update = database.prepare("UPDATE todos SET due_at = ? WHERE id = ?");
    for (const row of rows) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.due_date);
      if (!m) continue;
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const day = parseInt(m[3], 10);
      const ms = new Date(y, mo, day, 20, 0, 0, 0).getTime();
      update.run(ms, row.id);
    }
  } catch {
    // backfill best-effort
  }
  const defaultListId = "default";
  const row = database.prepare("SELECT 1 FROM todo_lists WHERE id = ?").get(defaultListId);
  if (!row) {
    database.prepare("INSERT INTO todo_lists (id, name, sort_order) VALUES (?, ?, 0)").run(defaultListId, "Standard");
  }
}
