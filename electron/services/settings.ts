import { app } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DEFAULT_SETTINGS } from '../shared/ipc.js';
import type { AppSettings } from '../shared/ipc.js';

let cache: AppSettings | null = null;

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** Load settings from disk, falling back to defaults for any missing keys. */
export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  let stored: Partial<AppSettings> = {};
  try {
    stored = JSON.parse(await readFile(settingsFile(), 'utf8'));
  } catch {
    // No file yet — use defaults.
  }
  // Default output path: the OS Downloads folder under a Proxima subfolder.
  const fallbackOut = join(app.getPath('downloads'), 'Proxima');
  cache = {
    ...DEFAULT_SETTINGS,
    defaultOutputPath: DEFAULT_SETTINGS.defaultOutputPath || fallbackOut,
    ...stored,
  };
  return cache;
}

/** Merge a partial patch into settings and persist. Returns the full set. */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings();
  cache = { ...current, ...patch };
  try {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Best-effort persistence; keep the in-memory value either way.
  }
  return cache;
}
