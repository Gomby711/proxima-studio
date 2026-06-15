import { useEffect, useRef, useState, useCallback } from "react";
import { Film, X, Loader, AlertCircle } from "lucide-react";
import { api } from "../../lib/media";
import type { MediaInfo } from "../../../electron/shared/ipc";

export type SourcePreviewTarget = { path: string; name: string };

const f = { fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif" };

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * HandBrake-style live source preview: probes the file, then extracts a frame at
 * any timestamp as you scrub the slider. Frames are lazily pulled from ffmpeg.
 */
export function SourcePreview({ target, onClose }: { target: SourcePreviewTarget; onClose: () => void }) {
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [pos, setPos] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only ever apply the newest frame request; ignore stale ones mid-scrub.
  const reqId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFrame = useCallback(async (atSec: number) => {
    if (!api) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const url = await api.previewFrame(target.path, atSec);
      if (id === reqId.current) { setFrameUrl(url); setError(null); }
    } catch {
      if (id === reqId.current) setError("Couldn't render a preview frame for this file.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [target.path]);

  // Probe on open, then show a frame ~10% in (or the image itself).
  useEffect(() => {
    let alive = true;
    (async () => {
      const meta = (await api?.previewInfo(target.path)) ?? { durationSeconds: 0, width: 0, height: 0 };
      if (!alive) return;
      setInfo(meta);
      const start = meta.durationSeconds > 0 ? meta.durationSeconds * 0.1 : 0;
      setPos(start);
      loadFrame(start);
    })();
    return () => { alive = false; };
  }, [target.path, loadFrame]);

  // Scrub: update the slider instantly, debounce the (expensive) frame extract.
  const onScrub = (v: number) => {
    setPos(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => loadFrame(v), 140);
  };

  const duration = info?.durationSeconds ?? 0;
  const hasScrub = duration > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div
        className="rounded-lg overflow-hidden flex flex-col"
        style={{ width: 760, maxWidth: "92vw", background: "rgba(31,24,50,0.82)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <Film size={16} style={{ color: "var(--tool-accent)" }} />
          <span className="flex-1 truncate" style={{ ...f, fontSize: 14, fontWeight: 600, color: "#ebebeb" }} title={target.name}>
            {target.name}
          </span>
          {info && info.width > 0 && (
            <span style={{ ...f, fontSize: 12, color: "#b6b6c2" }}>{info.width}×{info.height}</span>
          )}
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[rgba(255,255,255,0.06)]" style={{ color: "#c2c2cc" }} title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Frame */}
        <div className="relative flex items-center justify-center" style={{ background: "#0d0d0f", minHeight: 300, aspectRatio: "16 / 9" }}>
          {frameUrl && <img src={frameUrl} alt="Source preview" className="max-w-full max-h-full object-contain" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: frameUrl ? "rgba(0,0,0,0.25)" : "transparent" }}>
              <Loader size={26} className="animate-spin" style={{ color: "var(--tool-accent)" }} />
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ color: "#e05252" }}>
              <AlertCircle size={26} />
              <span style={{ ...f, fontSize: 13 }}>{error}</span>
            </div>
          )}
        </div>

        {/* Scrubber */}
        <div className="px-5 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          {hasScrub ? (
            <div className="flex items-center gap-3">
              <span style={{ ...f, fontSize: 12, color: "#b2b2b2", width: 56 }}>{fmtTime(pos)}</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={Math.max(0.1, duration / 400)}
                value={pos}
                onChange={(e) => onScrub(Number(e.target.value))}
                className="flex-1 cursor-pointer"
                style={{ accentColor: "var(--tool-accent)" }}
              />
              <span style={{ ...f, fontSize: 12, color: "#b6b6c2", width: 56, textAlign: "right" }}>{fmtTime(duration)}</span>
            </div>
          ) : (
            <p style={{ ...f, fontSize: 12, color: "#b6b6c2", textAlign: "center" }}>
              Still image — no timeline to scrub.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
