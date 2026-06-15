import { app } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { HistoryEntry } from '../shared/ipc.js';

let cache: HistoryEntry[] | null = null;

function historyFile(): string {
  return join(app.getPath('userData'), 'history.json');
}

/** Read the persisted job history (newest first). */
export async function listHistory(): Promise<HistoryEntry[]> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(historyFile(), 'utf8'));
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Prepend a completed job and persist. Returns the full list. */
export async function addHistory(entry: HistoryEntry): Promise<HistoryEntry[]> {
  const list = await listHistory();
  cache = [entry, ...list].slice(0, 500);
  await persist();
  return cache;
}

/** Remove a single entry by id and persist. */
export async function removeHistory(id: string): Promise<HistoryEntry[]> {
  const list = await listHistory();
  cache = list.filter((e) => e.id !== id);
  await persist();
  return cache;
}

/** Wipe the history. */
export async function clearHistory(): Promise<void> {
  cache = [];
  await persist();
}

async function persist(): Promise<void> {
  try {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(historyFile(), JSON.stringify(cache ?? [], null, 2), 'utf8');
  } catch {
    // Best-effort.
  }
}
