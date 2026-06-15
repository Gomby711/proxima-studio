// Renderer-side helpers shared across the tool panels.

/** Human-readable byte size. */
export function fmtBytes(b: number): string {
  if (!b || b < 0) return "—";
  if (b >= 1e12) return (b / 1e12).toFixed(2) + " TB";
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return Math.round(b / 1e3) + " KB";
}

// FormatPicker ids that aren't valid file extensions get mapped to a real one.
const EXT_MAP: Record<string, string> = {
  ProRes: "mov",
  HEVC: "mp4",
  DNxHD: "mov",
  MXF: "mxf",
};

/** Turn a FormatPicker id (e.g. "ProRes", "MP4") into a usable file extension. */
export function toExt(formatId: string): string {
  return (EXT_MAP[formatId] ?? formatId).toLowerCase();
}

export type QualityBucket = "low" | "medium" | "high" | "lossless";

/** Map a 1–100 quality slider to the backend's preset buckets. */
export function qualityBucket(n: number): QualityBucket {
  if (n >= 95) return "lossless";
  if (n >= 80) return "high";
  if (n >= 50) return "medium";
  return "low";
}

/** The typed Electron bridge, or undefined when not running under Electron. */
export const api: Window["api"] | undefined =
  typeof window !== "undefined" ? window.api : undefined;

/** Resolve a dropped/selected File to its absolute path via the preload bridge. */
export function pathOf(file: File): string {
  return api?.getPathForFile(file) ?? "";
}

/** Run async tasks with a max concurrency. */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const n = Math.max(1, limit);
  const runners = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}
