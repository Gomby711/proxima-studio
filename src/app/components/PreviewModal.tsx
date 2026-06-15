import { Eye, FolderOpen, X, CheckCircle } from "lucide-react";
import { api } from "../../lib/media";

export type PreviewTarget = { path: string; name: string; kind: "video" | "image" | "audio" };

/** Shown after a conversion/compression finishes — offers to view the result. */
export function PreviewModal({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  const f = { fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif" };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        className="rounded-lg p-6 flex flex-col gap-4"
        style={{ width: 420, background: "rgba(39,31,58,0.82)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <CheckCircle size={20} style={{ color: "#3dd68c" }} />
          <span style={{ ...f, fontSize: 16, fontWeight: 700, color: "#ebebeb" }}>
            {target.kind === "video" ? "Video ready" : target.kind === "audio" ? "Audio ready" : "Image ready"}
          </span>
        </div>
        <p className="truncate" style={{ ...f, fontSize: 13, color: "#b2b2b2" }} title={target.path}>
          {target.name}
        </p>
        <p style={{ ...f, fontSize: 12, color: "#b6b6c2" }}>
          {target.kind === "video"
            ? "Open it in your default video player, or reveal it in the folder."
            : target.kind === "audio"
            ? "Open it in your default audio player, or reveal it in the folder."
            : "Open it in your default image viewer, or reveal it in the folder."}
        </p>

        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={() => { api?.openPath(target.path); onClose(); }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md transition-all"
            style={{ ...f, fontSize: 13, fontWeight: 700, background: "var(--tool-accent)", color: "#fff", boxShadow: "0 2px 12px color-mix(in srgb, var(--tool-accent) 28%, transparent)" }}
          >
            <Eye size={15} /> {target.kind === "video" ? "Play video" : target.kind === "audio" ? "Play audio" : "View image"}
          </button>
          <button
            onClick={() => { api?.showInFolder(target.path); onClose(); }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-md transition-all"
            style={{ ...f, fontSize: 13, fontWeight: 600, background: "rgba(50,40,71,0.25)", border: "1px solid rgba(255,255,255,0.1)", color: "#cfcfcf" }}
          >
            <FolderOpen size={15} /> Show in folder
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.06)]"
            style={{ color: "#b6b6c2" }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
