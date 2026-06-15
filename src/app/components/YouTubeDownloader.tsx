import { useState, useEffect, useRef } from "react";
import {
  Youtube, Download, CheckCircle, Loader, AlertCircle, X, Eye, ThumbsUp, Clock, Plus, FolderOpen,
} from "lucide-react";
import { FormatPicker, type Format } from "./FormatPicker";
import { Switch } from "./Switch";
import { TaskList, type TaskRow } from "./TaskList";
import { api, toExt, runPool } from "../../lib/media";
import type { AppSettings, VideoInfo, HistoryEntry } from "../../../electron/shared/ipc";

type FetchStatus = "idle" | "fetching" | "ready" | "error";

const QUALITIES = [
  { id: "4k",    label: "4K",     height: 2160 as const, size: "~4.2 GB", codec: "VP9",      res: "3840×2160", fps: "60" },
  { id: "2k",    label: "2K",     height: 1440 as const, size: "~2.1 GB", codec: "VP9",      res: "2560×1440", fps: "60" },
  { id: "1080p", label: "1080p",  height: 1080 as const, size: "~850 MB", codec: "H.264",    res: "1920×1080", fps: "60" },
  { id: "720p",  label: "720p",   height: 720  as const, size: "~380 MB", codec: "H.264",    res: "1280×720",  fps: "30" },
  { id: "480p",  label: "480p",   height: 480  as const, size: "~140 MB", codec: "H.264",    res: "854×480",   fps: "30" },
  { id: "audio", label: "Audio",  height: 0,             size: "~24 MB",  codec: "AAC 320k", res: "—",         fps: "—"  },
];

const s = {
  label: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "#b6b6c2", textTransform: "uppercase" as const, letterSpacing: "0.1em" },
  mono:  { fontFamily: "var(--font-mono)" },
};

const dirOf  = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const baseOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stripExt = (name: string) => name.replace(/\.[^.\\/]+$/, "");

function fmtCount(n: number): string {
  if (!n) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}

export function YouTubeDownloader({ settings, onJobDone }: { settings: AppSettings; onJobDone: () => void }) {
  const [url, setUrl]                 = useState("");
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [info, setInfo]               = useState<VideoInfo | null>(null);
  const [fetchError, setFetchError]   = useState("");
  const [selectedQuality, setSelectedQuality] = useState("1080p");
  const [outputFormat, setOutputFormat] = useState<Format | null>(null);
  const [batchUrls, setBatchUrls]     = useState("");
  const [options, setOptions]         = useState<Record<string, boolean>>({});
  const [postProcess, setPostProcess] = useState({
    embedSubs: false,
    normalizeAudio: false,
    removeMetadata: false,
    trimSilence: false,
    splitByChapter: false,
  });
  const [tasks, setTasks]             = useState<TaskRow[]>([]);
  const [outputDir, setOutputDir]     = useState<string>(settings.defaultOutputPath);
  const [defaultDir, setDefaultDir]   = useState<string>(settings.defaultOutputPath);
  const [saveAsPath, setSaveAsPath]   = useState<string | null>(null);
  const userPickedDir = useRef(false);

  const qual = QUALITIES.find((q) => q.id === selectedQuality) ?? QUALITIES[2];
  const isAudio = qual.id === "audio";
  const OPTIONS = isAudio ? ["Audio only"] : ["Cap at selected quality"];

  useEffect(() => {
    if (!userPickedDir.current) setOutputDir(settings.defaultOutputPath);
  }, [settings.defaultOutputPath]);

  useEffect(() => {
    let alive = true;
    api?.defaultOutputDir().then((d) => {
      if (!alive) return;
      setDefaultDir(d);
      if (!userPickedDir.current && !settings.defaultOutputPath) setOutputDir(d);
    });
    return () => { alive = false; };
  }, [settings.defaultOutputPath]);

  // Seed the task panel with previously-downloaded items (shown as done).
  const loadRecent = async () => {
    const list = (await api?.historyList()) ?? [];
    const recent: TaskRow[] = list
      .filter((h: HistoryEntry) => h.tool === "download")
      .slice(0, 12)
      .map((h) => ({
        id: h.id, name: h.name, state: "done", progress: 100, indeterminate: false,
        outputPath: h.outputPath, meta: h.to, accent: "#cc3333",
      }));
    setTasks((prev) => {
      // Keep any in-flight session tasks; merge history for completed ones.
      const active = prev.filter((t) => t.state === "running" || t.state === "queued" || t.state === "error");
      const seen = new Set(active.map((t) => t.id));
      return [...active, ...recent.filter((r) => !seen.has(r.id))];
    });
  };
  useEffect(() => { loadRecent(); /* eslint-disable-next-line */ }, []);

  // Route download progress into the matching task row.
  useEffect(() => {
    if (!api) return;
    return api.onProgress((p) => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== p.jobId) return t;
        if (p.percent < 0) return { ...t, indeterminate: true };
        return { ...t, indeterminate: false, progress: Math.round(p.percent * 100) };
      }));
    });
  }, []);

  const browseSavePath = async () => {
    if (!api) return;
    const ext = outputFormat ? toExt(outputFormat.id) : (isAudio ? "mp3" : "mp4");
    const base = info?.title ? info.title.replace(/[\\/:*?"<>|]/g, "").trim() : "download";
    const filters = [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }];
    const picked = await api.pickSavePath({ defaultName: `${base}.${ext}`, defaultDir: outputDir || defaultDir || undefined, filters });
    if (picked) { userPickedDir.current = true; setSaveAsPath(picked); setOutputDir(dirOf(picked)); }
  };

  const handleFetch = async () => {
    if (!url.trim() || !api) return;
    setFetchStatus("fetching");
    setFetchError("");
    try {
      const meta = await api.getInfo(url.trim());
      setInfo(meta);
      setFetchStatus("ready");
    } catch (err) {
      setFetchError(String(err).includes("Unsupported") ? "Unsupported or private URL." : "Could not analyze this URL. Check the link and your connection.");
      setFetchStatus("error");
    }
  };

  // Run a download for a task row that already exists. Shared by the single
  // (Analyze) flow and the batch queue so both report progress identically and
  // each lands in the chosen output folder.
  const runDownloadJob = async (jobId: string, targetUrl: string, customName?: string) => {
    if (!api || !outputFormat) return;
    setTasks((prev) => prev.map((t) => t.id === jobId ? { ...t, state: "running", indeterminate: false } : t));
    try {
      const res = await api.download({
        jobId,
        url: targetUrl,
        outputDir: outputDir || settings.defaultOutputPath,
        maxHeight: isAudio ? undefined : (qual.height as 2160 | 1440 | 1080 | 720 | 480),
        audioOnly: isAudio,
        format: toExt(outputFormat.id),
        outputName: customName,
        postProcess,
      });
      setTasks((prev) => prev.map((t) => t.id === jobId
        ? { ...t, state: "done", progress: 100, indeterminate: false, outputPath: res.outputPath, name: res.title || t.name, meta: outputFormat.id }
        : t));
      onJobDone();
    } catch {
      setTasks((prev) => prev.map((t) => t.id === jobId ? { ...t, state: "error", indeterminate: false, error: "Download failed — check the link and folder." } : t));
    }
  };

  const startDownload = async (targetUrl: string, name: string, outName?: string, customName?: string) => {
    if (!api || !outputFormat) return;
    const jobId = Math.random().toString(36).slice(2);
    setTasks((prev) => [
      { id: jobId, name, outName, state: "running", progress: 0, indeterminate: false, accent: "#cc3333" },
      ...prev,
    ]);
    await runDownloadJob(jobId, targetUrl, customName);
  };

  const handleDownload = async () => {
    const outName = saveAsPath ? baseOf(saveAsPath) : undefined;
    const customName = saveAsPath ? stripExt(baseOf(saveAsPath)) : undefined;
    await startDownload(url.trim(), info?.title ?? url.trim(), outName, customName);
  };

  const handleBatch = async () => {
    const urls = batchUrls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (!urls.length || !outputFormat) return;
    setBatchUrls("");
    // Create a queued row for EVERY url up-front so the whole batch is visible
    // immediately, then drain them through a concurrency pool — every video
    // downloads and lands in the chosen folder without any re-clicking.
    const jobs = urls.map((u) => ({ id: Math.random().toString(36).slice(2), url: u }));
    setTasks((prev) => [
      ...jobs.map((j) => ({
        id: j.id, name: j.url, state: "queued" as const,
        progress: 0, indeterminate: false, accent: "#cc3333",
      })),
      ...prev,
    ]);
    const limit = Math.max(1, Number(settings.concurrentDownloads) || 2);
    await runPool(jobs, limit, (j) => runDownloadJob(j.id, j.url));
  };

  const activeRunning = tasks.some((t) => t.state === "running");
  const canDownload = !!outputFormat && !!(outputDir || settings.defaultOutputPath) && fetchStatus === "ready";

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: controls ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-7 pt-7 pb-5 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <h1 style={{ color: "#ebebeb" }}>YouTube Downloader</h1>
          <p className="mt-1" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#b6b6c2" }}>
            Download any YouTube video in full HD. Choose quality, format, destination, and filename.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5 space-y-4">
          {/* URL input */}
          <div>
            <p style={s.label} className="mb-2">YouTube URL</p>
            <div className="neon flex items-stretch rounded-md overflow-hidden transition-all"
              style={{ border: `1px solid ${fetchStatus === "ready" ? "rgba(61,214,140,0.4)" : fetchStatus === "error" ? "rgba(224,82,82,0.4)" : "rgba(255,255,255,0.1)"}`, background: "rgba(39,31,58,0.22)" }}>
              <div className="flex items-center px-4 border-r shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <Youtube size={16} style={{ color: "#cc3333" }} />
              </div>
              <input type="url" value={url}
                onChange={(e) => { setUrl(e.target.value); if (fetchStatus !== "idle") setFetchStatus("idle"); }}
                onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                placeholder="https://www.youtube.com/watch?v=…"
                className="flex-1 bg-transparent focus:outline-none px-4 py-3"
                style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#d1d1d1" }} />
              {fetchStatus === "ready"   && <div className="flex items-center pr-3"><CheckCircle size={15} style={{ color: "#3dd68c" }} /></div>}
              {fetchStatus === "error"   && <div className="flex items-center pr-3"><AlertCircle size={15} style={{ color: "#e05252" }} /></div>}
              {fetchStatus === "fetching"&& <div className="flex items-center pr-3"><Loader size={15} className="animate-spin" style={{ color: "var(--tool-accent)" }} /></div>}
              {url && fetchStatus !== "fetching" && (
                <button onClick={() => { setUrl(""); setFetchStatus("idle"); setInfo(null); }} className="flex items-center pr-3">
                  <X size={14} style={{ color: "#a0a0ae" }} />
                </button>
              )}
              <button onClick={handleFetch} disabled={!url.trim() || fetchStatus === "fetching"}
                className="neon-btn px-5 flex items-center gap-2 transition-all disabled:opacity-40"
                style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 700, background: "color-mix(in srgb, var(--tool-accent) 68%, #000)", color: "#fff" }}>
                {fetchStatus === "fetching" ? <Loader size={13} className="animate-spin" /> : null}
                Analyze
              </button>
            </div>
            {fetchStatus === "error" && (
              <p className="mt-1.5" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#e05252" }}>{fetchError}</p>
            )}
          </div>

          {/* Destination — folder + filename */}
          <div>
            <p style={s.label} className="mb-2">Save download to</p>
            <div className="neon flex items-center gap-2 px-3 py-2.5 rounded-md" style={{ background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <FolderOpen size={14} style={{ color: "#b6b6c2", flexShrink: 0 }} />
              <input
                value={saveAsPath ? dirOf(saveAsPath) : outputDir}
                onChange={(e) => { userPickedDir.current = true; setSaveAsPath(null); setOutputDir(e.target.value); }}
                placeholder={defaultDir || "Paste or type an output folder…"}
                spellCheck={false}
                className="flex-1 bg-transparent focus:outline-none"
                style={{ ...s.mono, fontSize: 12, color: "#b2b2b2" }}
                title={saveAsPath ?? outputDir}
              />
              {saveAsPath && (
                <span className="shrink-0 truncate" style={{ ...s.mono, fontSize: 11, color: "var(--tool-accent)", maxWidth: 160 }} title={baseOf(saveAsPath)}>
                  {baseOf(saveAsPath)}
                </span>
              )}
              {(saveAsPath || userPickedDir.current) && (
                <button onClick={() => { setSaveAsPath(null); userPickedDir.current = false; setOutputDir(settings.defaultOutputPath || defaultDir); }}
                  className="flex items-center justify-center w-6 h-6 rounded-sm shrink-0 hover:bg-[rgba(255,255,255,0.06)]" style={{ color: "#b6b6c2" }} title="Reset">
                  <X size={12} />
                </button>
              )}
              <button onClick={browseSavePath} className="neon-btn px-2.5 py-1 rounded-md shrink-0"
                style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 600, background: "color-mix(in srgb, var(--tool-accent) 12%, transparent)", color: "var(--tool-accent)" }}>
                Browse
              </button>
            </div>
          </div>

          {/* Video preview */}
          {fetchStatus === "ready" && info && (
            <div className="flex gap-4 p-4 rounded-md" style={{ background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <div className="relative shrink-0 rounded-md overflow-hidden" style={{ width: 196, height: 110, background: "#141414" }}>
                {info.thumbnail
                  ? <img src={info.thumbnail} alt={info.title} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><Youtube size={28} style={{ color: "#cc3333" }} /></div>}
                <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-sm" style={{ ...s.mono, fontSize: 11, background: "rgba(0,0,0,0.8)", color: "#fff" }}>
                  {info.durationLabel}
                </div>
              </div>
              <div className="flex flex-col justify-between flex-1 min-w-0">
                <div>
                  <p style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 14, fontWeight: 600, color: "#ebebeb", lineHeight: 1.4 }}>{info.title}</p>
                  <p className="mt-0.5" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#b6b6c2" }}>{info.channel}</p>
                </div>
                <div className="flex items-center gap-5">
                  {[
                    { icon: <Eye size={12} />, val: fmtCount(info.viewCount) },
                    { icon: <ThumbsUp size={12} />, val: fmtCount(info.likeCount) },
                    { icon: <Clock size={12} />, val: info.durationLabel },
                  ].map((m, i) => (
                    <div key={i} className="flex items-center gap-1.5" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#b6b6c2" }}>
                      {m.icon} {m.val}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quality + format — always shown so quality/format can be set and the
              batch queue used without analyzing a single video up top first. */}
          <div className="p-4 rounded-md space-y-4" style={{ background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <div>
                <p style={s.label} className="mb-2.5">Quality</p>
                <div className="flex items-stretch gap-2">
                  {QUALITIES.map((q) => {
                    const active = selectedQuality === q.id;
                    return (
                      <button key={q.id} onClick={() => setSelectedQuality(q.id)} className="flex flex-col items-start px-4 py-2.5 rounded-md transition-all"
                        style={{ flex: "1", background: active ? "color-mix(in srgb, var(--tool-accent) 10%, transparent)" : "rgba(255,255,255,0.04)", border: `1px solid ${active ? "color-mix(in srgb, var(--tool-accent) 40%, transparent)" : "rgba(255,255,255,0.08)"}` }}>
                        <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 700, color: active ? "var(--tool-accent)" : "#c4c4c4" }}>{q.label}</span>
                        {q.res !== "—" && <span style={{ ...s.mono, fontSize: 11, color: "#a0a0ae", marginTop: 2 }}>{q.fps}fps</span>}
                        <span style={{ ...s.mono, fontSize: 11, color: "#9696a4", marginTop: 1 }}>{q.size}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <p style={s.label} className="mb-2">Output format</p>
                  <FormatPicker value={outputFormat?.id ?? null} onChange={setOutputFormat}
                    allowedCategories={isAudio ? ["audio"] : ["video", "audio"]} placeholder="Select format…" />
                </div>
                <div className="px-3 py-2 rounded-md shrink-0" style={{ background: "rgba(31,24,50,0.22)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <p style={s.label} className="mb-0.5">Codec</p>
                  <p style={{ ...s.mono, fontSize: 12, color: "#c2c2cc" }}>{qual.codec}</p>
                </div>
              </div>

              {/* Options */}
              <div className="flex items-center gap-4 flex-wrap">
                {OPTIONS.map((opt) => (
                  <div key={opt} className="flex items-center gap-2">
                    <Switch checked={!!options[opt]} onChange={(v) => setOptions((p) => ({ ...p, [opt]: v }))} />
                    <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#b2b2b2" }}>{opt}</span>
                  </div>
                ))}
              </div>
            </div>

          {/* Download button */}
          {fetchStatus === "ready" && (
            <button onClick={handleDownload} disabled={!canDownload}
              className="neon-btn w-full flex items-center justify-center gap-2.5 py-3.5 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 14, fontWeight: 700, background: canDownload ? "var(--tool-accent)" : "rgba(50,40,71,0.25)", color: canDownload ? "#fff" : "#b6b6c2", border: canDownload ? "none" : "1px solid rgba(255,255,255,0.08)", boxShadow: canDownload ? "0 2px 12px color-mix(in srgb, var(--tool-accent) 28%, transparent)" : "none" }}>
              {activeRunning ? <><Loader size={15} className="animate-spin" /> Downloading…</> : <><Download size={15} /> Download {qual.label} · {outputFormat?.id ?? "select format"}</>}
            </button>
          )}

          {/* Batch */}
          <div>
            <p style={s.label} className="mb-2">Batch queue — one URL per line</p>
            <div className="neon rounded-md">
              <textarea value={batchUrls} onChange={(e) => setBatchUrls(e.target.value)} placeholder={"https://youtube.com/…\nhttps://youtube.com/…"} rows={3}
                className="w-full resize-none rounded-md px-3 py-3 focus:outline-none transition-colors"
                style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, background: "rgba(39,31,58,0.22)", border: "none", color: "#cfcfcf" }} />
            </div>
            <button onClick={handleBatch} disabled={!batchUrls.trim() || !outputFormat}
              className="neon-btn mt-2 flex items-center justify-center gap-2 py-2 px-4 rounded-md transition-all disabled:opacity-40"
              style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 600, background: "rgba(39,31,58,0.22)", color: "#c2c2cc" }}>
              <Plus size={12} /> Queue all
            </button>
          </div>

          {/* Post-processing — polish applied to each download */}
          <div>
            <p style={s.label} className="mb-2">Post-processing</p>
            <div className="neon rounded-md overflow-hidden" style={{ background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.09)" }}>
              {([
                { key: "embedSubs",      label: "Embed Subtitles",  hint: "Bake a subtitle track into the video file" },
                { key: "normalizeAudio", label: "Normalize Audio",  hint: "Even out loudness to a broadcast level" },
                { key: "removeMetadata", label: "Remove Metadata",  hint: "Strip tags, chapters and embedded info" },
                { key: "trimSilence",    label: "Trim Silence",     hint: "Cut silent gaps from the audio" },
                { key: "splitByChapter", label: "Split by Chapter", hint: "Save one file per YouTube chapter" },
              ] as const).map((opt, i, arr) => (
                <div key={opt.key}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                  <div className="min-w-0 pr-3">
                    <p style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#d1d1d1" }}>{opt.label}</p>
                    <p className="mt-0.5" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 11, color: "#b6b6c2" }}>{opt.hint}</p>
                  </div>
                  <Switch
                    checked={postProcess[opt.key]}
                    onChange={(v) => setPostProcess((p) => ({ ...p, [opt.key]: v }))}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Empty state */}
          {fetchStatus === "idle" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 opacity-25">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: "rgba(200,50,50,0.1)", border: "1.5px dashed rgba(200,50,50,0.3)" }}>
                <Youtube size={28} style={{ color: "#cc3333" }} />
              </div>
              <p style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#b6b6c2" }}>
                Paste a YouTube URL above to get started
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: downloads task panel (~half) ── */}
      <div className="flex-1 flex flex-col overflow-hidden border-l p-5" style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(24,18,37,0.16)" }}>
        <TaskList
          title="Downloads"
          emptyHint="Your current and finished downloads will appear here."
          tasks={tasks}
          onRemove={(id) => { setTasks((p) => p.filter((t) => t.id !== id)); api?.historyRemove(id).then(onJobDone); }}
          onClear={tasks.length ? () => { tasks.forEach((t) => api?.historyRemove(t.id)); setTasks([]); onJobDone(); } : undefined}
        />
      </div>
    </div>
  );
}
