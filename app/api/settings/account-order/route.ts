/**
 * Account order persistence. Uses a JSON file in data/ (can be replaced with SQLite/Postgres later).
 */
import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

const log = createLogger("api:settings:account-order");

function getFilePath(): string {
  return path.join(ensureProjectDataDir(), "account-order.json");
}

function readOrder(): string[] {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]).filter((id) => typeof id === "string") : [];
  } catch (e) {
    log.warn({ err: e }, "account-order read failed");
    return [];
  }
}

function writeOrder(order: string[]): void {
  const filePath = getFilePath();
  fs.writeFileSync(filePath, JSON.stringify(order), "utf-8");
}

/**
 * GET: return saved account order (array of account IDs).
 */
export async function GET() {
  try {
    const order = readOrder();
    return NextResponse.json({ order });
  } catch (e) {
    log.error({ err: e }, "GET account-order failed");
    return NextResponse.json({ error: "Failed to read account order" }, { status: 500 });
  }
}

/**
 * PUT: save account order. Body: { order: string[] }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const order = body?.order;
    if (!Array.isArray(order)) {
      return NextResponse.json({ error: "Missing or invalid order array" }, { status: 400 });
    }
    const valid = (order as unknown[]).filter((id): id is string => typeof id === "string");
    writeOrder(valid);
    log.info({ count: valid.length }, "account-order saved");
    return NextResponse.json({ order: valid });
  } catch (e) {
    log.error({ err: e }, "PUT account-order failed");
    return NextResponse.json({ error: "Failed to save account order" }, { status: 500 });
  }
}
