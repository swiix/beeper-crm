import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import {
  readTodoSettings,
  writeTodoSettings,
  MIN_TODO_MESSAGE_LIMIT,
  MAX_TODO_MESSAGE_LIMIT,
  MIN_DEADLINE_DAYS,
  MAX_DEADLINE_DAYS,
  MIN_TODO_MAX_MESSAGE_AGE_DAYS,
  MAX_TODO_MAX_MESSAGE_AGE_DAYS,
  MIN_TODO_DEFAULT_DURATION_HOURS,
  MAX_TODO_DEFAULT_DURATION_HOURS,
} from "@/lib/todo-settings";
import { clearTodoSuggestionsCache } from "@/lib/todo-db";

const log = createLogger("api:settings:todo-list");

export async function GET() {
  try {
    const settings = readTodoSettings();
    return NextResponse.json(settings);
  } catch (e) {
    log.error({ err: e }, "GET todo-list settings failed");
    return NextResponse.json({ error: "Failed to read todo-list settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const current = readTodoSettings();
    const limit =
      typeof body?.todoListMessageLimit === "number" && !Number.isNaN(body.todoListMessageLimit)
        ? Math.min(MAX_TODO_MESSAGE_LIMIT, Math.max(MIN_TODO_MESSAGE_LIMIT, Math.round(body.todoListMessageLimit)))
        : current.todoListMessageLimit;
    const days =
      typeof body?.todoListDefaultDeadlineDays === "number" && !Number.isNaN(body.todoListDefaultDeadlineDays)
        ? Math.min(MAX_DEADLINE_DAYS, Math.max(MIN_DEADLINE_DAYS, Math.round(body.todoListDefaultDeadlineDays)))
        : current.todoListDefaultDeadlineDays;
    const scanMode =
      body?.todoListMessageScanMode === "count" || body?.todoListMessageScanMode === "age" || body?.todoListMessageScanMode === "both"
        ? body.todoListMessageScanMode
        : current.todoListMessageScanMode;
    const maxAgeDays =
      typeof body?.todoListMaxMessageAgeDays === "number" && !Number.isNaN(body.todoListMaxMessageAgeDays)
        ? Math.min(MAX_TODO_MAX_MESSAGE_AGE_DAYS, Math.max(MIN_TODO_MAX_MESSAGE_AGE_DAYS, Math.round(body.todoListMaxMessageAgeDays)))
        : current.todoListMaxMessageAgeDays;
    const promptChanged =
      typeof body?.todoListPrompt === "string" && body.todoListPrompt.trim() !== current.todoListPrompt.trim();
    const todoSyncTarget =
      body?.todoSyncTarget === "google" || body?.todoSyncTarget === "reclaim"
        ? body.todoSyncTarget
        : body?.autoSyncReclaimOnAccept === true && body?.autoSyncGoogleTasksOnAccept === false
          ? "reclaim"
          : current.todoSyncTarget;
    const autoSyncOnAccept =
      typeof body?.autoSyncOnAccept === "boolean"
        ? body.autoSyncOnAccept
        : typeof body?.autoSyncGoogleTasksOnAccept === "boolean" && todoSyncTarget === "google"
          ? body.autoSyncGoogleTasksOnAccept
          : typeof body?.autoSyncReclaimOnAccept === "boolean" && todoSyncTarget === "reclaim"
            ? body.autoSyncReclaimOnAccept
            : current.autoSyncOnAccept;
    const defaultDurationHours =
      typeof body?.todoListDefaultDurationHours === "number" && !Number.isNaN(body.todoListDefaultDurationHours)
        ? Math.min(
            MAX_TODO_DEFAULT_DURATION_HOURS,
            Math.max(MIN_TODO_DEFAULT_DURATION_HOURS, Number(body.todoListDefaultDurationHours.toFixed(2)))
          )
        : current.todoListDefaultDurationHours;
    const next = {
      todoListPrompt:
        typeof body?.todoListPrompt === "string" ? body.todoListPrompt : current.todoListPrompt,
      todoListMessageLimit: limit,
      todoListDefaultDeadlineDays: days,
      todoListMessageScanMode: scanMode,
      todoListMaxMessageAgeDays: maxAgeDays,
      todoSyncTarget,
      autoSyncOnAccept,
      todoListDefaultDurationHours: defaultDurationHours,
    };
    writeTodoSettings(next);
    if (promptChanged) {
      clearTodoSuggestionsCache();
      log.info("todo-list settings saved; todo suggestions cache cleared (prompt changed)");
    } else {
      log.info("todo-list settings saved");
    }
    return NextResponse.json({ ...next, promptChanged: !!promptChanged });
  } catch (e) {
    log.error({ err: e }, "PUT todo-list settings failed");
    return NextResponse.json({ error: "Failed to save todo-list settings" }, { status: 500 });
  }
}
