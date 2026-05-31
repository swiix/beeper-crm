import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getTodoLists, createTodoList } from "@/lib/todo-db";
import { randomUUID } from "crypto";

const log = createLogger("api:todo-list:lists");

/**
 * GET /api/todo-list/lists
 */
export async function GET() {
  try {
    const lists = getTodoLists();
    return NextResponse.json(lists);
  } catch (e) {
    log.error({ err: e }, "GET lists failed");
    return NextResponse.json({ error: "Failed to list todo lists" }, { status: 500 });
  }
}

/**
 * POST /api/todo-list/lists
 * Body: { name: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const id = randomUUID();
    const sortOrder = typeof body?.sort_order === "number" ? body.sort_order : 0;
    createTodoList(id, name, sortOrder);
    const lists = getTodoLists();
    const created = lists.find((l) => l.id === id);
    return NextResponse.json(created ?? { id, name, sort_order: sortOrder }, { status: 201 });
  } catch (e) {
    log.error({ err: e }, "POST list failed");
    return NextResponse.json({ error: "Failed to create list" }, { status: 500 });
  }
}
