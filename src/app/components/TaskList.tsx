import type { ReactNode } from "react";
import {
  CheckCircle, AlertCircle, Loader, Download, FolderOpen, X, ListChecks, Eye,
} from "lucide-react";
import { api } from "../../lib/media";

export type TaskState = "queued" | "running" | "done" | "error";

export type TaskRow = {
  id: string;
  name: string;
  /** Destination filename, shown as "→ name.ext". */
  outName?: string;
  state: TaskState;
  progress: number;        // 0..100
  indeterminate: boolean;
  outputPath?: string;
  error?: string;
  /** Small right-aligned meta (e.g. size or "−62%"). */
  meta?: string;
  /** Running-bar color (defaults to orange). */
  accent?: string;
  icon?: ReactNode;
};

const f = { fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif" };
const label = { ...f, fontSize: 11, fontWeight: 600, color: "#b6b6c2", textTransform: "uppercase" as const, letterSpacing: "0.08em" };

/**
 * Shared task panel used by every tool. Shows current + completed jobs; finished
 * jobs persist with a green check + 100%, and offer Download (save a copy) and
 * Open-file-location actions.
 */
export function TaskList({
  tasks, onRemove, onClear, onPreview, title = "Tasks", emptyHint = "Tasks you start will appear here.",
}: {
  tasks: TaskRow[];
  onRemove: (id: string) => void;
  onClear?: () => void;
  onPreview?: (id: string) => void;
  title?: string;
  emptyHint?: string;
}) {
  const doneCount = tasks.filter((t) => t.state === "done").length;

  // Keep active work at the very top of the log: running first, then queued,
  // then errors, then completed jobs. The sort is stable, so the caller's
  // newest-first ordering is preserved within each group.
  const STATE_ORDER: Record<TaskState, number> = { running: 0, queued: 1, error: 2, done: 3 };
  const ordered = [...tasks].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);

  return (
    <div className="neon flex flex-col h-full overflow-hidden rounded-md" style={{ border: "1px solid rgba(255,255,255,0.09)", background: "rgba(39,31,58,0.22)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(31,24,50,0.22)" }}>
        <ListChecks size={13} style={{ color: "#b6b6c2" }} />
        <span style={label}>{title}</span>
        {tasks.length > 0 && (
          <span style={{ ...f, fontSize: 11, color: "#b6b6c2" }}>
            {doneCount > 0 ? `${doneCount}/${tasks.length} done` : `${tasks.length} queued`}
          </span>
        )}
        <div className="flex-1" />
        {onClear && tasks.length > 0 && (
          <button onClick={onClear} className="neon-btn px-2.5 py-1 rounded-md" style={{ ...f, fontSize: 11, color: "#cfcfcf", background: "rgba(255,255,255,0.05)" }}>
            Clear
          </button>
        )}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 h-full opacity-40 px-6 text-center">
            <ListChecks size={24} style={{ color: "#b6b6c2" }} />
            <p style={{ ...f, fontSize: 12, color: "#b6b6c2" }}>{emptyHint}</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            {ordered.map((t) => {
              const accent = t.accent ?? "var(--tool-accent)";
              return (
                <div key={t.id} className="px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      {t.state === "done" ? <CheckCircle size={14} style={{ color: "#3dd68c" }} />
                        : t.state === "error" ? <AlertCircle size={14} style={{ color: "#e05252" }} />
                        : t.state === "running" ? <Loader size={13} className="animate-spin" style={{ color: accent }} />
                        : (t.icon ?? <Download size={13} style={{ color: "#b6b6c2" }} />)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate flex-1" style={{ ...f, fontSize: 13, fontWeight: 500, color: "#d1d1d1" }} title={t.name}>{t.name}</p>
                        {t.meta && <span className="shrink-0" style={{ ...f, fontSize: 11, color: "#b6b6c2" }}>{t.meta}</span>}
                      </div>
                      {t.outName && (
                        <p className="truncate" style={{ ...f, fontSize: 11, color: "#b6b6c2", marginTop: 1 }}>→ {t.outName}</p>
                      )}

                      {/* Progress / status line */}
                      {t.state === "running" && (
                        <>
                          <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
                            <div className="h-full rounded-full transition-all duration-300"
                              style={{ width: t.indeterminate ? "40%" : `${Math.max(3, t.progress)}%`, background: accent, boxShadow: `0 0 8px ${accent}88`, opacity: t.indeterminate ? 0.6 : 1 }} />
                          </div>
                          <p style={{ ...f, fontSize: 11, color: accent, marginTop: 3 }}>{t.indeterminate ? "Working…" : `${t.progress}%`}</p>
                        </>
                      )}
                      {t.state === "queued" && <p style={{ ...f, fontSize: 11, color: "#b6b6c2", marginTop: 3 }}>Queued</p>}
                      {t.state === "error" && <p className="truncate" style={{ ...f, fontSize: 11, color: "#e05252", marginTop: 3 }} title={t.error}>{t.error || "Failed"}</p>}
                      {t.state === "done" && (
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <span className="flex items-center gap-1" style={{ ...f, fontSize: 12, fontWeight: 700, color: "#3dd68c" }}>
                            <CheckCircle size={12} /> 100%
                          </span>
                          <div className="w-px h-3 mx-0.5" style={{ background: "rgba(255,255,255,0.1)" }} />
                          <button onClick={() => t.outputPath && api?.saveCopy(t.outputPath)}
                            className="neon-btn flex items-center gap-1 px-2.5 py-1 rounded-md" style={{ ...f, fontSize: 11, fontWeight: 600, background: "color-mix(in srgb, var(--tool-accent) 12%, transparent)", color: "var(--tool-accent)" }}>
                            <Download size={11} /> Download
                          </button>
                          <button onClick={() => t.outputPath && api?.showInFolder(t.outputPath)}
                            className="neon-btn flex items-center gap-1 px-2.5 py-1 rounded-md" style={{ ...f, fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.05)", color: "#cfcfcf" }}>
                            <FolderOpen size={11} /> Open location
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center shrink-0">
                      {onPreview && (
                        <button onClick={() => onPreview(t.id)} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[color-mix(in_srgb,var(--tool-accent)_12%,transparent)]" style={{ color: "#b6b6c2" }} title="Preview source">
                          <Eye size={12} />
                        </button>
                      )}
                      <button onClick={() => onRemove(t.id)} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[rgba(224,82,82,0.12)]" style={{ color: "#9696a4" }} title="Remove">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
