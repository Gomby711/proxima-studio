import { useState, useCallback, useRef, useEffect } from "react";
import {
  Film, Image as ImageIcon, Music, FileVideo, FileImage, FileAudio,
  X, ArrowRight, Plus,
  ChevronDown, ChevronUp, Settings2, RotateCcw, Zap, FolderOpen,
} from "lucide-react";
import { FormatPicker, type Format } from "./FormatPicker";
import { NeonSelect } from "./NeonSelect";
import { PreviewModal, type PreviewTarget } from "./PreviewModal";
import { SourcePreview, type SourcePreviewTarget } from "./SourcePreview";
import { TaskList, type TaskRow } from "./TaskList";
import logoUrl from "../../assets/proxima-logo.png";
import { api, toExt, qualityBucket, pathOf, runPool } from "../../lib/media";
import type { AppSettings, HistoryEntry } from "../../../electron/shared/ipc";

const VIDEO_EXTS = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv", "mxf", "mpg", "mpeg"];
const AUDIO_EXTS = ["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma", "aiff", "aif"];

// ─── Types ───────────────────────────────────────────────────────────────────

type JobStatus = "queued" | "converting" | "done" | "error";
type MediaMode  = "video" | "image" | "audio";

type Job = {
  id: string;
  name: string;
  path: string;
  size: number;
  inputExt: string;
  outputFormat: Format | null;
  status: JobStatus;
  progress: number;
  indeterminate: boolean;
  outputPath?: string;
  error?: string;
};

// ─── Static data ─────────────────────────────────────────────────────────────

const PRESETS = [
  { id: "yt4k",      label: "YouTube 4K",      detail: "3840×2160 · 60 fps · H.264 · 45 Mbps" },
  { id: "cinema",    label: "Cinema DCP",       detail: "4096×2160 · 24 fps · JPEG2000 · 250 Mbps" },
  { id: "reel",      label: "Instagram Reel",   detail: "1080×1920 · 30 fps · H.264 · 8 Mbps" },
  { id: "broadcast", label: "Broadcast HD",     detail: "1920×1080 · 29.97 fps · DNxHD" },
  { id: "prores",    label: "ProRes 4444",       detail: "Original res · 24 fps · Apple ProRes" },
  { id: "web",       label: "Web Optimised",    detail: "1920×1080 · 30 fps · H.265 · 4 Mbps" },
  { id: "custom",    label: "Custom",           detail: "Define your own parameters" },
];

const FPS_OPTIONS = ["23.976", "24", "25", "29.97", "30", "60"];
const CODEC_OPTIONS = ["H.264", "H.265", "ProRes 422", "ProRes 4444", "DNxHD", "VP9", "AV1"];
const HW_OPTIONS = ["CUDA", "Metal", "OpenCL", "CPU"];
const COLOR_OPTIONS = ["Rec.709", "Rec.2020", "DCI-P3", "sRGB"];

// ─── Shared style helpers ────────────────────────────────────────────────────

const s = {
  label: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "#b6b6c2", textTransform: "uppercase" as const, letterSpacing: "0.1em" },
  mono:  { fontFamily: "var(--font-mono)" },
  surface: { background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.09)" },
};

// ─── Path helpers (renderer-side, cross-platform) ────────────────────────────

const dirOf  = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const baseOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stripExt = (name: string) => name.replace(/\.[^.\\/]+$/, "");
/** Force a file path/name to end with the given extension. */
const withExt = (p: string, ext: string) => `${p.replace(/\.[^.\\/]*$/, "")}.${ext}`;

// ─── Component ───────────────────────────────────────────────────────────────

export function FileConverter({ settings, onJobDone }: { settings: AppSettings; onJobDone: () => void }) {
  const [mode, setMode]               = useState<MediaMode>("video");
  const [globalFmt, setGlobalFmt]     = useState<Format | null>(null);
  const [jobs, setJobs]               = useState<Job[]>([]);
  const [dragging, setDragging]       = useState(false);
  const [preset, setPreset]           = useState("yt4k");
  const [quality, setQuality]         = useState(88);
  const [fps, setFps]                 = useState("30");
  const [codec, setCodec]             = useState("H.264");
  const [hw, setHw]                   = useState("CUDA");
  const [colorSpace, setColorSpace]   = useState("Rec.709");
  const [showSettings, setShowSettings] = useState(false);
  const [outputDir, setOutputDir]     = useState<string>(settings.defaultOutputPath);
  const [defaultDir, setDefaultDir]   = useState<string>(settings.defaultOutputPath);
  const [saveAsPath, setSaveAsPath]   = useState<string | null>(null);
  const [preview, setPreview]         = useState<PreviewTarget | null>(null);
  const [srcPreview, setSrcPreview]   = useState<SourcePreviewTarget | null>(null);
  // Finished conversions from earlier sessions, reloaded from persisted history
  // so the task panel always shows this user's past results across restarts.
  const [pastRows, setPastRows]       = useState<TaskRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const histToRow = useCallback((h: HistoryEntry): TaskRow => {
    const to = h.to.toLowerCase();
    const icon = AUDIO_EXTS.includes(to)
      ? <FileAudio size={13} style={{ color: "#b6b6c2" }} />
      : VIDEO_EXTS.includes(to)
      ? <FileVideo size={13} style={{ color: "#b6b6c2" }} />
      : <FileImage size={13} style={{ color: "#b6b6c2" }} />;
    return {
      id: h.id,
      name: h.name,
      state: "done",
      progress: 100,
      indeterminate: false,
      outputPath: h.outputPath,
      meta: `${h.from} → ${h.to}`,
      icon,
    };
  }, []);

  const loadHistory = useCallback(async () => {
    const list = (await api?.historyList()) ?? [];
    setPastRows(list.filter((h) => h.tool === "convert").map(histToRow));
  }, [histToRow]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Refresh both the global history panel and our persistent rows on completion.
  const handleJobDone = useCallback(() => { onJobDone(); loadHistory(); }, [onJobDone, loadHistory]);

  // When the mode changes, drop a format selection that no longer fits the new
  // category (e.g. an MP4 left over when switching to Audio) so the picker and
  // every queued job reset cleanly to the new mode.
  useEffect(() => {
    const cat = mode === "video" ? "video" : mode === "audio" ? "audio" : "image";
    if (globalFmt && globalFmt.category !== cat) {
      setGlobalFmt(null);
      setJobs((p) => p.map((j) => ({ ...j, outputFormat: null })));
    }
  }, [mode, globalFmt]);

  // Keep the output folder in sync with the saved default until the user picks one.
  const userPickedDir = useRef(false);
  useEffect(() => {
    if (!userPickedDir.current) setOutputDir(settings.defaultOutputPath);
  }, [settings.defaultOutputPath]);

  // Resolve the real default destination (saved setting, else ~/Videos — like
  // HandBrake). This guarantees the "Save to" bar always shows a concrete folder
  // instead of vaguely "same folder as source".
  useEffect(() => {
    let alive = true;
    api?.defaultOutputDir().then((d) => {
      if (!alive) return;
      setDefaultDir(d);
      if (!userPickedDir.current && !settings.defaultOutputPath) setOutputDir(d);
    });
    return () => { alive = false; };
  }, [settings.defaultOutputPath]);

  // Route backend progress events into the matching job row.
  useEffect(() => {
    if (!api) return;
    return api.onProgress((p) => {
      setJobs((prev) => prev.map((j) => {
        if (j.id !== p.jobId) return j;
        if (p.percent < 0) return { ...j, indeterminate: true };
        return { ...j, indeterminate: false, progress: Math.round(p.percent * 100) };
      }));
    });
  }, []);

  // Build a queued job from an absolute file path (the reliable, HandBrake-style
  // route — native dialogs always give us a real path the converter can use).
  const jobFromPath = useCallback((path: string, size = 0): Job => {
    const name = path.split(/[\\/]/).pop() ?? path;
    return {
      id: Math.random().toString(36).slice(2),
      name,
      path,
      size,
      inputExt: (name.split(".").pop() ?? "").toUpperCase(),
      outputFormat: globalFmt,
      status: "queued",
      progress: 0,
      indeterminate: false,
    };
  }, [globalFmt]);

  const addPaths = useCallback((paths: string[]) => {
    const next = paths.filter(Boolean).map((p) => jobFromPath(p));
    if (next.length) setJobs((p) => [...p, ...next]);
  }, [jobFromPath]);

  // Drag-and-drop hands us File objects; resolve each to its real path.
  const addFiles = useCallback((files: File[]) => {
    const next = files
      .map((f) => ({ f, path: pathOf(f) }))
      .filter((x) => x.path)
      .map((x) => jobFromPath(x.path, x.f.size));
    if (next.length) setJobs((p) => [...p, ...next]);
  }, [jobFromPath]);

  // Primary "Add files" / dropzone-click path: native OS picker → real paths.
  const pickFilesNative = useCallback(async () => {
    const paths = await api?.pickFiles();
    if (paths && paths.length) addPaths(paths);
  }, [addPaths]);

  // "Browse" opens a Save As dialog so the user can choose the folder AND name
  // the output file in one step. With a single file queued the chosen path is
  // used verbatim; with several, only its folder applies (each keeps its name).
  const browseSavePath = async () => {
    if (!api) return;
    const first = jobs[0];
    const ext = globalFmt ? toExt(globalFmt.id) : (first ? first.inputExt.toLowerCase() : "");
    const baseName = first ? stripExt(first.name) : "output";
    const defaultName = ext ? `${baseName}.${ext}` : baseName;
    const filters = globalFmt
      ? [{ name: `${globalFmt.label} file`, extensions: [toExt(globalFmt.id)] }]
      : undefined;
    const picked = await api.pickSavePath({ defaultName, defaultDir: outputDir || defaultDir || undefined, filters });
    if (picked) {
      userPickedDir.current = true;
      setSaveAsPath(picked);
      setOutputDir(dirOf(picked));
    }
  };

  const runJob = async (job: Job, attempt = 0): Promise<void> => {
    const fmt = job.outputFormat ?? globalFmt;
    if (!fmt || !job.path || !api) return;
    setJobs((p) => p.map((j) => j.id === job.id ? { ...j, status: "converting", progress: 0, error: undefined } : j));
    try {
      // Honour an explicit "Save As" name only when converting a single file.
      const explicitPath = saveAsPath && jobs.length === 1 ? withExt(saveAsPath, toExt(fmt.id)) : undefined;
      const res = await api.convert({
        jobId: job.id,
        inputPath: job.path,
        targetFormat: toExt(fmt.id),
        outputDir: outputDir || undefined,
        outputPath: explicitPath,
        quality: qualityBucket(quality),
        vcodec: codec,
        fps,
      });
      setJobs((p) => p.map((j) => j.id === job.id ? { ...j, status: "done", progress: 100, indeterminate: false, outputPath: res.outputPath } : j));
      handleJobDone();
      if (settings.openPreviewPrompt) {
        setPreview({ path: res.outputPath, name: res.outputPath.split(/[\\/]/).pop() ?? job.name, kind: mode });
      }
    } catch (err) {
      if (settings.autoRetry && attempt === 0) return runJob(job, 1);
      setJobs((p) => p.map((j) => j.id === job.id ? { ...j, status: "error", indeterminate: false, error: String(err) } : j));
    }
  };

  const convertAll = async () => {
    const queued = jobs.filter((j) => j.status === "queued" && (j.outputFormat ?? globalFmt) && j.path);
    // Convert every queued file on a single click — run them all at once instead
    // of throttling to a small batch the user has to re-trigger for the rest.
    await runPool(queued, queued.length, (j) => runJob(j));
  };

  const canConvert = jobs.some((j) => j.status === "queued" && (j.outputFormat ?? globalFmt) && j.path);
  const doneCount  = jobs.filter((j) => j.status === "done").length;

  // What the "Save to" bar shows: a named file (single-file Save As) or a folder.
  const namedSingle = saveAsPath && jobs.length === 1;
  const effectiveDir = outputDir || defaultDir;
  const saveLabel = namedSingle
    ? (globalFmt ? withExt(saveAsPath!, toExt(globalFmt.id)) : saveAsPath!)
    : (effectiveDir || "Your Videos folder");

  // The exact destination filename a job will produce (HandBrake shows this).
  const outName = (job: Job): string | null => {
    const fmt = job.outputFormat ?? globalFmt;
    if (!fmt) return null;
    if (saveAsPath && jobs.length === 1) return baseOf(withExt(saveAsPath, toExt(fmt.id)));
    return `${stripExt(job.name)}.${toExt(fmt.id)}`;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {preview && <PreviewModal target={preview} onClose={() => setPreview(null)} />}
      {srcPreview && <SourcePreview target={srcPreview} onClose={() => setSrcPreview(null)} />}

      {/* ── Page header ── */}
      <div className="px-7 pt-7 pb-5 shrink-0 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <div className="flex items-center justify-between gap-6">
          <div className="flex-1 min-w-0">
            <h1 style={{ color: "#ebebeb" }}>
              {mode === "video" ? "Video Converter" : mode === "audio" ? "Audio Converter" : "Image Converter"}
            </h1>
            <p className="mt-1" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#b6b6c2", lineHeight: 1.5, minHeight: 38 }}>
              {mode === "audio"
                ? "Extract or convert audio from any video or audio file to MP3, WAV, FLAC and more. Batch-process your entire pipeline."
                : `Convert any ${mode} file to industry-standard formats. Batch-process your entire pipeline.`}
            </p>
          </div>

          {/* Mode toggle — glowing segmented pill */}
          <div className="tabbar shrink-0">
            {(["video", "image", "audio"] as const).map((m) => {
              const active = mode === m;
              return (
                <button key={m} onClick={() => setMode(m)} data-active={active} className="tabbtn">
                  <span style={{ color: active ? "var(--tool-accent)" : "currentColor", display: "flex" }}>
                    {m === "video" ? <Film size={13} /> : m === "audio" ? <Music size={13} /> : <ImageIcon size={13} />}
                  </span>
                  <span style={{ ...s.mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "currentColor" }}>
                    {m === "video" ? "VIDEO" : m === "audio" ? "AUDIO" : "IMAGE"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Format bar ── */}
        <div className="flex items-end gap-3 mt-5">
          <div>
            <p style={s.label} className="mb-1.5">From</p>
            <div className="neon flex items-center gap-2.5 px-4 py-2.5 rounded-md" style={{ ...s.surface, width: 170 }}>
              {mode === "video"
                ? <FileVideo size={15} style={{ color: "#b6b6c2", flexShrink: 0 }} />
                : mode === "audio"
                ? <FileAudio size={15} style={{ color: "#b6b6c2", flexShrink: 0 }} />
                : <FileImage size={15} style={{ color: "#b6b6c2", flexShrink: 0 }} />}
              <span className="truncate" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 14, fontWeight: 600, color: "#c4c4c4", whiteSpace: "nowrap" }}>
                {mode === "video" ? "Any Video" : mode === "audio" ? "Audio or Video" : "Any Image"}
              </span>
            </div>
          </div>

          <ArrowRight size={16} style={{ color: "#9696a4", marginBottom: 10, flexShrink: 0 }} />

          <div className="flex-1" style={{ maxWidth: 280 }}>
            <p style={s.label} className="mb-1.5">Convert to</p>
            <FormatPicker
              value={globalFmt?.id ?? null}
              onChange={(f) => {
                setGlobalFmt(f);
                setJobs((p) => p.map((j) => ({ ...j, outputFormat: f })));
              }}
              allowedCategories={mode === "video" ? ["video"] : mode === "audio" ? ["audio"] : ["image"]}
              placeholder="Select output format…"
            />
          </div>

          <button
            onClick={() => setShowSettings((v) => !v)}
            data-active={showSettings}
            className="neon-btn flex items-center gap-1.5 px-3 py-2.5 rounded-md transition-all mb-0"
            style={{
              ...s.surface,
              background: showSettings ? "color-mix(in srgb, var(--tool-accent) 10%, transparent)" : "rgba(39,31,58,0.22)",
              border: `1px solid ${showSettings ? "color-mix(in srgb, var(--tool-accent) 35%, transparent)" : "rgba(255,255,255,0.09)"}`,
              color: showSettings ? "var(--tool-accent)" : "#b6b6c2",
              fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 500,
            }}
          >
            <Settings2 size={14} />
            Settings
            {showSettings ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          <button onClick={pickFilesNative}
            className="neon-btn flex items-center gap-1.5 px-3 py-2.5 rounded-md transition-all"
            style={{ background: "color-mix(in srgb, var(--tool-accent) 68%, #000)", color: "#fff", fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 700, boxShadow: "0 2px 10px color-mix(in srgb, var(--tool-accent) 22%, transparent)" }}>
            <Plus size={14} /> Add files
          </button>
        </div>

        {/* ── Output destination — pick folder + name the file ── */}
        <div className="flex items-center gap-2.5 mt-3">
          <p style={s.label} className="shrink-0">Save to</p>
          <div className="neon flex-1 flex items-center gap-2 px-3 py-2 rounded-md" style={s.surface}>
            <FolderOpen size={14} style={{ color: "#b6b6c2", flexShrink: 0 }} />
            <input
              value={saveAsPath ? dirOf(saveAsPath) : outputDir}
              onChange={(e) => { userPickedDir.current = true; setSaveAsPath(null); setOutputDir(e.target.value); }}
              placeholder={defaultDir || "Paste or type an output folder…"}
              spellCheck={false}
              className="flex-1 bg-transparent focus:outline-none"
              style={{ ...s.mono, fontSize: 12, color: "#b2b2b2" }}
              title={saveLabel}
            />
            {saveAsPath && jobs.length === 1 && (
              <span className="shrink-0 truncate" style={{ ...s.mono, fontSize: 11, color: "var(--tool-accent)", maxWidth: 160 }} title={baseOf(saveLabel)}>
                {baseOf(saveLabel)}
              </span>
            )}
            {(saveAsPath || userPickedDir.current) && (
              <button
                onClick={() => { setSaveAsPath(null); userPickedDir.current = false; setOutputDir(settings.defaultOutputPath || defaultDir); }}
                className="flex items-center justify-center w-6 h-6 rounded-sm shrink-0 hover:bg-[rgba(255,255,255,0.06)]"
                style={{ color: "#b6b6c2" }}
                title="Reset output"
              >
                <X size={12} />
              </button>
            )}
            <button
              onClick={browseSavePath}
              className="neon-btn flex items-center gap-1.5 px-2.5 py-1 rounded-md shrink-0"
              style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 600, background: "color-mix(in srgb, var(--tool-accent) 12%, transparent)", color: "var(--tool-accent)" }}
            >
              Browse
            </button>
          </div>
        </div>

        {/* ── Settings panel ── */}
        {showSettings && (
          <div
            className="mt-3 p-5 rounded-md grid gap-6"
            style={{ background: "rgba(31,24,50,0.22)", border: "1px solid rgba(255,255,255,0.08)", gridTemplateColumns: "1fr 1fr 1fr 1fr" }}
          >
            <div>
              <p style={s.label} className="mb-2">Export Preset</p>
              <NeonSelect
                value={preset}
                options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                onChange={setPreset}
              />
              {PRESETS.find((p) => p.id === preset) && (
                <p className="mt-1" style={{ ...s.mono, fontSize: 11, color: "#9696a4" }}>
                  {PRESETS.find((p) => p.id === preset)!.detail}
                </p>
              )}
            </div>

            <div>
              <p style={s.label} className="mb-2">Codec</p>
              <div className="flex flex-wrap gap-1.5">
                {CODEC_OPTIONS.map((c) => (
                  <button key={c} onClick={() => setCodec(c)} data-active={codec === c} className="neon-btn px-2.5 py-1 rounded-md transition-all"
                    style={{ ...s.mono, fontSize: 11, fontWeight: 600, background: codec === c ? "color-mix(in srgb, var(--tool-accent) 14%, transparent)" : "rgba(255,255,255,0.04)", color: codec === c ? "var(--tool-accent)" : "#c2c2cc" }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {mode === "video" ? (
              <div>
                <p style={s.label} className="mb-2">Frame Rate</p>
                <div className="flex flex-wrap gap-1.5">
                  {FPS_OPTIONS.map((f) => (
                    <button key={f} onClick={() => setFps(f)} data-active={fps === f} className="neon-btn px-2.5 py-1 rounded-md transition-all"
                      style={{ ...s.mono, fontSize: 11, fontWeight: 600, background: fps === f ? "color-mix(in srgb, var(--tool-accent) 14%, transparent)" : "rgba(255,255,255,0.04)", color: fps === f ? "var(--tool-accent)" : "#c2c2cc" }}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div className="flex justify-between mb-2">
                  <p style={s.label}>Quality</p>
                  <span style={{ ...s.mono, fontSize: 12, fontWeight: 700, color: "var(--tool-accent)" }}>{quality}%</span>
                </div>
                <input type="range" min={1} max={100} value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="prismatic-range w-full"
                  style={{ background: `linear-gradient(90deg, #2f6bff 0%, #8c7cf0 ${(quality - 1) / 99 * 50}%, #a23cf0 ${(quality - 1) / 99 * 100}%, rgba(255,255,255,0.08) ${(quality - 1) / 99 * 100}%, rgba(255,255,255,0.08) 100%)` }} />
              </div>
            )}

            <div className="space-y-3">
              <div>
                <p style={s.label} className="mb-1.5">Hardware</p>
                <div className="flex gap-1.5">
                  {HW_OPTIONS.map((h) => (
                    <button key={h} onClick={() => setHw(h)} data-active={hw === h} className="neon-btn px-2 py-1 rounded-md transition-all"
                      style={{ ...s.mono, fontSize: 11, background: hw === h ? "color-mix(in srgb, var(--tool-accent) 14%, transparent)" : "rgba(255,255,255,0.04)", color: hw === h ? "var(--tool-accent)" : "#c2c2cc" }}>
                      {h}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p style={s.label} className="mb-1.5">Color Space</p>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_OPTIONS.map((c) => (
                    <button key={c} onClick={() => setColorSpace(c)} data-active={colorSpace === c} className="neon-btn px-2 py-1 rounded-md transition-all"
                      style={{ ...s.mono, fontSize: 11, background: colorSpace === c ? "color-mix(in srgb, var(--tool-accent) 14%, transparent)" : "rgba(255,255,255,0.04)", color: colorSpace === c ? "var(--tool-accent)" : "#c2c2cc" }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── File area: dropzone (left) + task list (right) ── */}
      <div className="flex-1 overflow-hidden flex gap-4 px-7 pt-5 pb-0">
        <div
          className="neon shrink-0 flex flex-col items-center justify-center gap-4 rounded-xl cursor-pointer transition-all"
          style={{
            width: 280,
            background: dragging ? "color-mix(in srgb, var(--tool-accent) 6%, transparent)" : "transparent",
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
          onClick={pickFilesNative}
        >
          <input ref={inputRef} type="file" multiple className="hidden"
            accept={mode === "video" ? "video/*" : mode === "audio" ? "audio/*,video/*" : "image/*"}
            onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <img src={logoUrl} alt="Proxima Studio" className="px-2"
            style={{ width: "100%", maxHeight: 190, objectFit: "contain", opacity: dragging ? 1 : 0.92, transition: "opacity .2s" }} />
          <div className="text-center px-3">
            <p style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 600, color: dragging ? "var(--tool-accent)" : "#c2c2cc" }}>
              Drop files here, or <span style={{ color: "var(--tool-accent)", fontWeight: 700 }}>browse</span>
            </p>
            <p className="mt-1" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 11, color: "#9696a4", lineHeight: 1.5 }}>
              {mode === "video"
                ? "MP4 · MOV · MKV · WEBM · ProRes · MXF"
                : mode === "audio"
                ? "MP3 · WAV · FLAC · AAC · M4A · OGG · OPUS"
                : "PNG · JPG · TIFF · WEBP · AVIF · EXR · PSD"}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <TaskList
            title="Conversions"
            emptyHint="Add files and hit Convert — jobs and results show here."
            tasks={(() => {
              const sessionRows = jobs.map((job): TaskRow => {
                const fmt = job.outputFormat ?? globalFmt;
                return {
                  id: job.id,
                  name: job.name,
                  outName: outName(job) ?? undefined,
                  state: job.status === "converting" ? "running" : job.status === "done" ? "done" : job.status === "error" ? "error" : "queued",
                  progress: job.progress,
                  indeterminate: job.indeterminate,
                  outputPath: job.outputPath,
                  error: job.error,
                  meta: fmt ? `${job.inputExt || "?"} → ${fmt.id}` : undefined,
                  icon: mode === "video" ? <FileVideo size={13} style={{ color: "#b6b6c2" }} /> : mode === "audio" ? <FileAudio size={13} style={{ color: "#b6b6c2" }} /> : <FileImage size={13} style={{ color: "#b6b6c2" }} />,
                };
              });
              const sessionIds = new Set(jobs.map((j) => j.id));
              // Newest session jobs first; TaskList then floats active ones to top.
              return [...sessionRows.reverse(), ...pastRows.filter((r) => !sessionIds.has(r.id))];
            })()}
            onRemove={(id) => {
              setJobs((p) => p.filter((j) => j.id !== id));
              setPastRows((p) => p.filter((r) => r.id !== id));
              api?.historyRemove(id).then(onJobDone);
            }}
            onClear={(jobs.length || pastRows.length) ? () => {
              pastRows.forEach((r) => api?.historyRemove(r.id));
              setJobs([]); setPastRows([]); onJobDone();
            } : undefined}
            onPreview={(id) => { const j = jobs.find((x) => x.id === id); if (j) setSrcPreview({ path: j.path, name: j.name }); }}
          />
        </div>
      </div>

      {/* ── Action bar ── */}
      <div className="neon flex items-center gap-3 mx-6 my-3 px-5 py-2.5 rounded-2xl shrink-0"
        style={{ background: "rgba(18,14,32,0.4)" }}>
        {jobs.length > 0 && (
          <button onClick={() => setJobs([])}
            className="flex items-center gap-2 px-3 py-2 rounded-md transition-all"
            style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 500, background: "transparent", border: "1px solid rgba(255,255,255,0.07)", color: "#b6b6c2" }}>
            <RotateCcw size={12} /> Clear
          </button>
        )}

        {jobs.length > 0 && (
          <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#9696a4" }}>
            {doneCount > 0 ? `${doneCount} / ${jobs.length} complete` : `${jobs.length} file${jobs.length !== 1 ? "s" : ""} queued`}
          </span>
        )}

        <div className="flex-1" />

        {!globalFmt && jobs.length > 0 && (
          <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#b6b6c2" }}>
            Select an output format to continue
          </span>
        )}

        <button
          onClick={convertAll}
          disabled={!canConvert}
          data-active={canConvert}
          className="neon-btn flex items-center gap-2.5 px-7 py-2.5 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: "0.18em",
            background: canConvert ? "linear-gradient(110deg, rgba(47,107,255,0.5), rgba(124,108,240,0.55) 55%, rgba(162,60,240,0.5))" : "rgba(50,40,71,0.3)",
            color: canConvert ? "#fff" : "#b6b6c2",
          }}
        >
          <Zap size={15} style={{ color: canConvert ? "#cfe2ff" : "#b6b6c2", filter: canConvert ? "drop-shadow(0 0 4px rgba(120,170,255,0.9))" : "none" }} />
          CONVERT
          {jobs.filter((j) => j.status === "queued").length > 0 && (
            <span className="px-1.5 py-0.5 rounded" style={{ ...s.mono, fontSize: 11, background: "rgba(255,255,255,0.2)" }}>
              {jobs.filter((j) => j.status === "queued").length}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
