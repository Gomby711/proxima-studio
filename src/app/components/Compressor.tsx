import { useState, useCallback, useRef, useEffect } from "react";
import {
  Film, Image as ImageIcon, Music, FileVideo, FileImage, FileAudio,
  X, Plus, RotateCcw, TrendingDown, FolderOpen,
} from "lucide-react";
import { PreviewModal, type PreviewTarget } from "./PreviewModal";
import { TaskList, type TaskRow } from "./TaskList";
import logoUrl from "../../assets/proxima-logo.png";
import { api, fmtBytes, pathOf, qualityBucket, runPool } from "../../lib/media";
import type { QualityBucket } from "../../lib/media";
import type { AppSettings as Settings, HistoryEntry } from "../../../electron/shared/ipc";

const VIDEO_EXTS = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv", "flv"];
const AUDIO_EXTS = ["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma", "aiff", "aif"];
const dirOf  = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const stripExt = (name: string) => name.replace(/\.[^.\\/]+$/, "");
const withExt = (p: string, ext: string) => `${p.replace(/\.[^.\\/]*$/, "")}.${ext}`;

type CompressMode = "image" | "video" | "audio";
type JobStatus    = "queued" | "compressing" | "done" | "error";

type Job = {
  id: string;
  name: string;
  path: string;
  type: CompressMode;
  status: JobStatus;
  progress: number;
  indeterminate: boolean;
  originalSize: number;
  compressedSize: number | null;
  outputPath?: string;
  error?: string;
};

// Profiles imply a target format + a quality bucket.
const IMAGE_PROFILES = [
  { id: "web",     label: "Web",         desc: "WEBP · Q72 · ~65% smaller",       ext: "webp", quality: 72 },
  { id: "social",  label: "Social",      desc: "JPG · Q82 · Instagram/Twitter",    ext: "jpg",  quality: 82 },
  { id: "email",   label: "Email",       desc: "JPG · Q60 · under 1 MB",           ext: "jpg",  quality: 60 },
  { id: "retina",  label: "Retina @2×",  desc: "PNG · Q85 · hi-DPI screens",       ext: "png",  quality: 85 },
  { id: "print",   label: "Print",       desc: "TIFF · Q95 · press-ready",         ext: "tiff", quality: 95 },
  { id: "archive", label: "Archive",     desc: "PNG · Lossless · no quality loss", ext: "png",  quality: 100 },
];

const VIDEO_PROFILES = [
  { id: "social",  label: "Social",      desc: "H.264 · 2 Mbps · Instagram/TikTok", ext: "mp4", bucket: "low"    as QualityBucket },
  { id: "web",     label: "Web",         desc: "H.264 · 4 Mbps · YouTube/Vimeo",    ext: "mp4", bucket: "medium" as QualityBucket },
  { id: "email",   label: "Email",       desc: "H.264 · 1 Mbps · under 25 MB",      ext: "mp4", bucket: "low"    as QualityBucket },
  { id: "mobile",  label: "Mobile",      desc: "H.265 · 800k · phone-optimised",    ext: "mp4", bucket: "low"    as QualityBucket },
  { id: "archive", label: "Archive HD",  desc: "H.265 · 8 Mbps · high quality",     ext: "mp4", bucket: "high"   as QualityBucket },
  { id: "prores",  label: "ProRes LT",   desc: "ProRes · near-lossless · post work", ext: "mov", bucket: "high"  as QualityBucket },
];

const AUDIO_PROFILES = [
  { id: "mp3",   label: "MP3 Music",  desc: "MP3 · 192k · balanced",    ext: "mp3", bucket: "medium" as QualityBucket },
  { id: "mp3hi", label: "MP3 High",   desc: "MP3 · 256k · transparent", ext: "mp3", bucket: "high"   as QualityBucket },
  { id: "mp3sm", label: "MP3 Small",  desc: "MP3 · 128k · portable",    ext: "mp3", bucket: "low"    as QualityBucket },
  { id: "m4a",   label: "AAC",        desc: "M4A · 192k · Apple",       ext: "m4a", bucket: "medium" as QualityBucket },
  { id: "ogg",   label: "OGG",        desc: "Vorbis · 160k · open",     ext: "ogg", bucket: "medium" as QualityBucket },
  { id: "voice", label: "Voice",      desc: "MP3 · 128k · speech",      ext: "mp3", bucket: "low"    as QualityBucket },
];

const s = {
  label: { fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "#b6b6c2", textTransform: "uppercase" as const, letterSpacing: "0.1em" },
  mono:  { fontFamily: "var(--font-mono)" },
};

export function Compressor({ settings, onJobDone }: { settings: Settings; onJobDone: () => void }) {
  const [mode, setMode]             = useState<CompressMode>("video");
  const [profile, setProfile]       = useState("web");
  const [quality, setQuality]       = useState(72);
  const [targetMB, setTargetMB]     = useState("5");
  const [method, setMethod]         = useState<"quality" | "size">("quality");
  const [dragging, setDragging]     = useState(false);
  const [jobs, setJobs]             = useState<Job[]>([]);
  const [outputDir, setOutputDir]   = useState<string>(settings.defaultOutputPath);
  const [defaultDir, setDefaultDir] = useState<string>(settings.defaultOutputPath);
  const [saveAsPath, setSaveAsPath] = useState<string | null>(null);
  const [preview, setPreview]       = useState<PreviewTarget | null>(null);
  // Finished compressions from earlier sessions, reloaded from persisted history.
  const [pastRows, setPastRows]     = useState<TaskRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const userPickedDir = useRef(false);

  const histToRow = useCallback((h: HistoryEntry): TaskRow => ({
    id: h.id,
    name: h.name,
    state: "done",
    progress: 100,
    indeterminate: false,
    outputPath: h.outputPath,
    meta: h.savings != null ? `−${h.savings}% · ${fmtBytes(h.bytes)}` : fmtBytes(h.bytes),
    accent: "#3dd68c",
    icon: AUDIO_EXTS.includes(h.to.toLowerCase())
      ? <FileAudio size={13} style={{ color: "#b6b6c2" }} />
      : VIDEO_EXTS.includes(h.to.toLowerCase())
      ? <FileVideo size={13} style={{ color: "#b6b6c2" }} />
      : <FileImage size={13} style={{ color: "#b6b6c2" }} />,
  }), []);

  const loadHistory = useCallback(async () => {
    const list = (await api?.historyList()) ?? [];
    setPastRows(list.filter((h) => h.tool === "compress").map(histToRow));
  }, [histToRow]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleJobDone = useCallback(() => { onJobDone(); loadHistory(); }, [onJobDone, loadHistory]);

  const profiles = mode === "image" ? IMAGE_PROFILES : mode === "audio" ? AUDIO_PROFILES : VIDEO_PROFILES;

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

  const jobFromPath = useCallback((path: string, size = 0): Job => {
    const name = path.split(/[\\/]/).pop() ?? path;
    const ext = (name.split(".").pop() ?? "").toLowerCase();
    const isAudio = AUDIO_EXTS.includes(ext);
    const isVideo = VIDEO_EXTS.includes(ext);
    return {
      id: Math.random().toString(36).slice(2),
      name,
      path,
      type: isAudio ? "audio" : isVideo ? "video" : "image",
      status: "queued",
      progress: 0,
      indeterminate: false,
      originalSize: size,
      compressedSize: null,
    };
  }, []);

  const addPaths = useCallback((paths: string[]) => {
    const next = paths.filter(Boolean).map((p) => jobFromPath(p));
    if (next.length) setJobs((p) => [...p, ...next]);
  }, [jobFromPath]);

  const addFiles = useCallback((files: File[]) => {
    const next = files
      .map((f) => ({ f, path: pathOf(f) }))
      .filter((x) => x.path)
      .map((x) => jobFromPath(x.path, x.f.size));
    if (next.length) setJobs((p) => [...p, ...next]);
  }, [jobFromPath]);

  const pickFilesNative = useCallback(async () => {
    const paths = await api?.pickFiles();
    if (paths && paths.length) addPaths(paths);
  }, [addPaths]);

  // "Browse" → Save As dialog: choose the destination folder AND name the file.
  const browseSavePath = async () => {
    if (!api) return;
    const first = jobs[0];
    const ext = targetExt();
    const baseName = first ? stripExt(first.name) : "compressed";
    const filters = [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }];
    const picked = await api.pickSavePath({ defaultName: `${baseName}.${ext}`, defaultDir: outputDir || defaultDir || undefined, filters });
    if (picked) { userPickedDir.current = true; setSaveAsPath(picked); setOutputDir(dirOf(picked)); }
  };

  /** Derive the quality bucket for the current settings/profile. */
  const bucketFor = (): QualityBucket => {
    if (mode === "video") {
      return (VIDEO_PROFILES.find((p) => p.id === profile)?.bucket) ?? "medium";
    }
    if (mode === "audio") {
      return (AUDIO_PROFILES.find((p) => p.id === profile)?.bucket) ?? "medium";
    }
    if (method === "size") {
      // Approximate: smaller target → more aggressive compression.
      const mb = Number(targetMB) || 5;
      return mb <= 1 ? "low" : mb <= 5 ? "medium" : "high";
    }
    return qualityBucket(quality);
  };

  const targetExt = (): string => {
    const p = profiles.find((x) => x.id === profile);
    return p?.ext ?? (mode === "image" ? "jpg" : mode === "audio" ? "mp3" : "mp4");
  };

  // Sensible per-type defaults so ANY file can be compressed — even one that
  // isn't the tool's current mode (e.g. dropping a video while on the Image tab).
  const DEFAULT_TARGET: Record<CompressMode, { ext: string; quality: QualityBucket }> = {
    image: { ext: "webp", quality: "medium" },
    video: { ext: "mp4",  quality: "medium" },
    audio: { ext: "mp3",  quality: "medium" },
  };

  // A file matching the active mode uses the selected profile/quality; any other
  // file type falls back to its default. Lets one mixed batch hold images, video
  // and audio together and compress each correctly.
  const targetForJob = (job: Job): { ext: string; quality: QualityBucket } =>
    job.type === mode ? { ext: targetExt(), quality: bucketFor() } : DEFAULT_TARGET[job.type];

  const runJob = async (job: Job, attempt = 0): Promise<void> => {
    if (!job.path || !api) return;
    setJobs((p) => p.map((j) => j.id === job.id ? { ...j, status: "compressing", progress: 0, error: undefined } : j));
    try {
      const { ext, quality } = targetForJob(job);
      const explicitPath = saveAsPath && jobs.length === 1 ? withExt(saveAsPath, ext) : undefined;
      const res = await api.convert({
        jobId: job.id,
        inputPath: job.path,
        targetFormat: ext,
        outputDir: outputDir || undefined,
        outputPath: explicitPath,
        quality,
        tool: "compress",
        originalBytes: job.originalSize,
      });
      setJobs((p) => p.map((j) => j.id === job.id ? { ...j, status: "done", progress: 100, indeterminate: false, compressedSize: res.bytes, outputPath: res.outputPath } : j));
      handleJobDone();
      if (settings.openPreviewPrompt) {
        setPreview({ path: res.outputPath, name: res.outputPath.split(/[\\/]/).pop() ?? job.name, kind: job.type });
      }
    } catch (err) {
      if (settings.autoRetry && attempt === 0) return runJob(job, 1);
      setJobs((p) => p.map((j) => j.id === job.id ? { ...j, status: "error", indeterminate: false, error: String(err) } : j));
    }
  };

  const compressAll = async () => {
    const queued = jobs.filter((j) => j.status === "queued" && j.path);
    // Compress every queued file on a single click — all at once, any count.
    await runPool(queued, queued.length, (j) => runJob(j));
  };

  const totalSaved = jobs
    .filter((j) => j.status === "done" && j.compressedSize !== null)
    .reduce((acc, j) => acc + Math.max(0, j.originalSize - (j.compressedSize ?? 0)), 0);

  const canCompress = jobs.some((j) => j.status === "queued" && j.path);

  const namedSingle = saveAsPath && jobs.length === 1;
  const effectiveDir = outputDir || defaultDir;
  const saveLabel = namedSingle
    ? withExt(saveAsPath!, targetExt())
    : (effectiveDir || "Your Videos folder");
  const outName = (job: Job): string => `${stripExt(job.name)}.${targetForJob(job).ext}`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {preview && <PreviewModal target={preview} onClose={() => setPreview(null)} />}

      {/* ── Header ── */}
      <div className="px-7 pt-7 pb-5 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <div className="flex items-center justify-between gap-6">
          <div>
            <h1 style={{ color: "#ebebeb" }}>File Compressor</h1>
            <p className="mt-1" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#b6b6c2" }}>
              Reduce file sizes for web, social, email, and archiving — without sacrificing quality.
            </p>
          </div>
          <div className="tabbar shrink-0">
            {(["video", "image", "audio"] as const).map((m) => {
              const active = mode === m;
              return (
                <button key={m} onClick={() => { setMode(m); setProfile(m === "audio" ? "mp3" : "web"); }} data-active={active} className="tabbtn">
                  <span style={{ color: active ? "var(--tool-accent)" : "currentColor", display: "flex" }}>
                    {m === "image" ? <ImageIcon size={13} /> : m === "audio" ? <Music size={13} /> : <Film size={13} />}
                  </span>
                  <span style={{ ...s.mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "currentColor" }}>
                    {m === "image" ? "IMAGE" : m === "audio" ? "AUDIO" : "VIDEO"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Profile selector */}
        <div className="mt-5 flex items-end gap-4">
          <div className="flex-1">
            <p style={s.label} className="mb-2">Compression Profile</p>
            <div className="flex gap-2">
              {profiles.map((p) => (
                <button key={p.id}
                  onClick={() => { setProfile(p.id); if ("quality" in p) setQuality((p as { quality: number }).quality); }}
                  data-active={profile === p.id}
                  className="neon-btn flex-1 flex flex-col items-start px-3.5 py-2.5 rounded-md transition-all"
                  style={{ background: profile === p.id ? "color-mix(in srgb, var(--tool-accent) 12%, transparent)" : "rgba(39,31,58,0.22)" }}>
                  <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 700, color: profile === p.id ? "var(--tool-accent)" : "#c4c4c4" }}>{p.label}</span>
                  <span style={{ ...s.mono, fontSize: 11, color: "#9696a4", marginTop: 3, lineHeight: 1.4 }}>{p.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <button onClick={pickFilesNative}
            className="neon-btn flex items-center gap-1.5 px-3.5 py-2.5 rounded-md transition-all shrink-0"
            style={{ background: "color-mix(in srgb, var(--tool-accent) 68%, #000)", color: "#fff", fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 700, boxShadow: "0 2px 10px color-mix(in srgb, var(--tool-accent) 22%, transparent)" }}>
            <Plus size={14} /> Add files
          </button>
        </div>

        {/* Quality control — always present so switching mode/method never shifts layout. */}
        <div className="neon mt-3 flex items-center gap-5 px-4 py-3 rounded-md" style={{ background: "rgba(31,24,50,0.22)", minHeight: 58 }}>
          {mode === "image" ? (
            <>
            <div className="flex gap-1.5 shrink-0">
              {(["quality", "size"] as const).map((m) => (
                <button key={m} onClick={() => setMethod(m)} data-active={method === m} className="neon-btn px-3 py-1.5 rounded-md transition-all"
                  style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 11, fontWeight: 600, background: method === m ? "color-mix(in srgb, var(--tool-accent) 14%, transparent)" : "rgba(255,255,255,0.04)", color: method === m ? "var(--tool-accent)" : "#c2c2cc" }}>
                  {m === "quality" ? "Quality" : "Target Size"}
                </button>
              ))}
            </div>

            {method === "quality" ? (
              <>
                <input type="range" min={1} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="prismatic-range flex-1"
                  style={{ background: `linear-gradient(90deg, #2f6bff 0%, #8c7cf0 ${(quality - 1) / 99 * 50}%, #a23cf0 ${(quality - 1) / 99 * 100}%, rgba(255,255,255,0.08) ${(quality - 1) / 99 * 100}%, rgba(255,255,255,0.08) 100%)` }} />
                <span style={{ ...s.mono, fontSize: 14, fontWeight: 700, color: "var(--tool-accent)", minWidth: 38, textAlign: "right" }}>{quality}%</span>
                <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#a0a0ae", minWidth: 110 }}>
                  {quality >= 90 ? "Near-lossless" : quality >= 75 ? "High quality" : quality >= 55 ? "Balanced" : "Aggressive"}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#b6b6c2" }}>Approx. max size</span>
                <div className="flex items-center gap-2">
                  <div className="neon rounded-md">
                    <input type="number" value={targetMB} min={0.1} step={0.5} onChange={(e) => setTargetMB(e.target.value)}
                      className="w-20 px-3 py-1.5 rounded-md text-center focus:outline-none"
                      style={{ ...s.mono, fontSize: 14, fontWeight: 700, background: "rgba(50,40,71,0.25)", border: "none", color: "var(--tool-accent)" }} />
                  </div>
                  <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#b6b6c2" }}>MB</span>
                </div>
                <div className="flex gap-1.5">
                  {["0.5", "1", "5", "10", "25"].map((v) => (
                    <button key={v} onClick={() => setTargetMB(v)} data-active={targetMB === v} className="neon-btn px-2 py-1 rounded-md transition-all"
                      style={{ ...s.mono, fontSize: 11, background: targetMB === v ? "color-mix(in srgb, var(--tool-accent) 14%, transparent)" : "rgba(255,255,255,0.04)", color: targetMB === v ? "var(--tool-accent)" : "#c2c2cc" }}>
                      {v} MB
                    </button>
                  ))}
                </div>
              </>
            )}
            </>
          ) : (
            <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#b6b6c2" }}>
              Compression level is set by the selected profile above.
            </span>
          )}
        </div>

        {/* Output destination — pick folder + name the file */}
        <div className="flex items-center gap-2.5 mt-3">
          <p style={s.label} className="shrink-0">Save to</p>
          <div className="neon flex-1 flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.09)" }}>
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
            {namedSingle && (
              <span className="shrink-0 truncate" style={{ ...s.mono, fontSize: 11, color: "var(--tool-accent)", maxWidth: 160 }}>
                {saveLabel.split(/[\\/]/).pop()}
              </span>
            )}
            {(saveAsPath || userPickedDir.current) && (
              <button onClick={() => { setSaveAsPath(null); userPickedDir.current = false; setOutputDir(settings.defaultOutputPath || defaultDir); }}
                className="flex items-center justify-center w-6 h-6 rounded-sm shrink-0 hover:bg-[rgba(255,255,255,0.06)]" style={{ color: "#b6b6c2" }} title="Reset output">
                <X size={12} />
              </button>
            )}
            <button onClick={browseSavePath} className="neon-btn flex items-center gap-1.5 px-2.5 py-1 rounded-md shrink-0"
              style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 600, background: "color-mix(in srgb, var(--tool-accent) 12%, transparent)", color: "var(--tool-accent)" }}>
              Browse
            </button>
          </div>
        </div>
      </div>

      {/* ── File area: dropzone (left) + task list (right) ── */}
      <div className="flex-1 overflow-hidden flex gap-4 px-7 pt-5 pb-0">
        <div className="neon shrink-0 flex flex-col items-center justify-center gap-4 rounded-xl cursor-pointer transition-all"
          style={{ width: 280, background: dragging ? "color-mix(in srgb, var(--tool-accent) 6%, transparent)" : "transparent" }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
          onClick={pickFilesNative}>
          <input ref={inputRef} type="file" multiple className="hidden"
            onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <img src={logoUrl} alt="Proxima Studio" className="px-2"
            style={{ width: "100%", maxHeight: 190, objectFit: "contain", opacity: dragging ? 1 : 0.92, transition: "opacity .2s" }} />
          <div className="text-center px-3">
            <p style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 600, color: dragging ? "var(--tool-accent)" : "#c2c2cc" }}>
              Drop files here, or <span style={{ color: "var(--tool-accent)", fontWeight: 700 }}>browse</span>
            </p>
            <p className="mt-1" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 11, color: "#9696a4", lineHeight: 1.5 }}>
              {mode === "image" ? "PNG · JPG · WEBP · TIFF · AVIF · EXR · PSD" : mode === "audio" ? "MP3 · WAV · FLAC · AAC · M4A · OGG" : "MP4 · MOV · MKV · WEBM · AVI"}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <TaskList
            title="Compressions"
            emptyHint="Add files and hit Compress — jobs and results show here."
            tasks={(() => {
              const sessionRows = jobs.map((job): TaskRow => {
                const savings = job.compressedSize !== null
                  ? Math.max(0, Math.round((1 - job.compressedSize / job.originalSize) * 100))
                  : null;
                const meta = job.status === "done" && savings !== null
                  ? `−${savings}% · ${fmtBytes(job.compressedSize ?? 0)}`
                  : fmtBytes(job.originalSize);
                return {
                  id: job.id,
                  name: job.name,
                  outName: outName(job),
                  state: job.status === "compressing" ? "running" : job.status === "done" ? "done" : job.status === "error" ? "error" : "queued",
                  progress: job.progress,
                  indeterminate: job.indeterminate,
                  outputPath: job.outputPath,
                  error: job.error,
                  meta,
                  accent: "#3dd68c",
                  icon: job.type === "audio" ? <FileAudio size={13} style={{ color: "#b6b6c2" }} /> : job.type === "video" ? <FileVideo size={13} style={{ color: "#b6b6c2" }} /> : <FileImage size={13} style={{ color: "#b6b6c2" }} />,
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
          />
        </div>
      </div>

      {/* ── Action bar ── */}
      <div className="neon flex items-center gap-3 mx-6 my-3 px-5 py-2.5 rounded-2xl shrink-0" style={{ background: "rgba(18,14,32,0.4)" }}>
        {jobs.length > 0 && (
          <button onClick={() => setJobs([])} className="flex items-center gap-2 px-3 py-2 rounded-md transition-all"
            style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 500, background: "transparent", border: "1px solid rgba(255,255,255,0.07)", color: "#b6b6c2" }}>
            <RotateCcw size={12} /> Clear
          </button>
        )}

        {totalSaved > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md" style={{ background: "rgba(61,214,140,0.08)", border: "1px solid rgba(61,214,140,0.2)" }}>
            <TrendingDown size={13} style={{ color: "#3dd68c" }} />
            <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 600, color: "#3dd68c" }}>{fmtBytes(totalSaved)} saved</span>
          </div>
        )}

        <div className="flex-1" />

        <button onClick={compressAll} disabled={!canCompress} data-active={canCompress}
          className="neon-btn flex items-center gap-2.5 px-7 py-2.5 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: "0.18em", background: canCompress ? "linear-gradient(110deg, rgba(47,107,255,0.5), rgba(124,108,240,0.55) 55%, rgba(162,60,240,0.5))" : "rgba(50,40,71,0.3)", color: canCompress ? "#fff" : "#b6b6c2" }}>
          <TrendingDown size={15} style={{ color: canCompress ? "#cfe2ff" : "#b6b6c2", filter: canCompress ? "drop-shadow(0 0 4px rgba(120,170,255,0.9))" : "none" }} />
          COMPRESS
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
