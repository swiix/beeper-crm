/**
 * Resolves the writable data directory for SQLite and JSON files.
 * WAL SQLite is unreliable on cloud-synced folders (Google Drive, iCloud, Dropbox, OneDrive).
 * When the project lives there and BEEPER_CRM_DATA_DIR is unset, data defaults to an OS-local path.
 */

import fs from "fs";
import path from "path";
import os from "os";

function isProbablyCloudSynced(absPath: string): boolean {
  const n = absPath.replace(/\\/g, "/").toLowerCase();
  return (
    n.includes("/library/cloudstorage/") ||
    n.includes("google drive") ||
    n.includes("/dropbox/") ||
    n.includes("/onedrive/") ||
    n.includes("/library/mobile documents/")
  );
}

function resolveLocalFallbackDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "beeper-crm");
  }
  if (process.platform === "win32") {
    const localApp = process.env.LOCALAPPDATA?.trim();
    if (localApp) {
      return path.join(localApp, "beeper-crm");
    }
    return path.join(home, "AppData", "Local", "beeper-crm");
  }
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) {
    return path.join(path.resolve(xdg), "beeper-crm");
  }
  return path.join(home, ".local", "share", "beeper-crm");
}

let cachedDir: string | null = null;

/**
 * Absolute data directory path; creates it if missing.
 */
export function ensureProjectDataDir(): string {
  if (cachedDir) return cachedDir;

  const fromEnv = process.env.BEEPER_CRM_DATA_DIR?.trim();
  let dir: string;
  if (fromEnv) {
    dir = path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  } else if (isProbablyCloudSynced(process.cwd())) {
    dir = resolveLocalFallbackDataDir();
  } else {
    dir = path.join(process.cwd(), "data");
  }

  fs.mkdirSync(dir, { recursive: true });
  mergeLegacyProjectData(dir);
  cachedDir = dir;
  return dir;
}

/** When cwd is cloud-synced, copy missing files from <project>/data into the resolved local dir once per file. */
function mergeLegacyProjectData(resolvedDir: string): void {
  if (!isProbablyCloudSynced(process.cwd())) return;
  const legacy = path.resolve(process.cwd(), "data");
  if (legacy === path.resolve(resolvedDir) || !fs.existsSync(legacy)) return;

  try {
    for (const name of fs.readdirSync(legacy)) {
      const from = path.join(legacy, name);
      const to = path.join(resolvedDir, name);
      if (fs.existsSync(to)) continue;
      const st = fs.statSync(from);
      if (st.isFile()) {
        fs.copyFileSync(from, to);
      }
    }
  } catch {
    // Best-effort; app can still start with an empty store.
  }
}
