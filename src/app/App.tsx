import { useState, useEffect, useCallback } from "react";
import {
  Film, Youtube, History, Settings, Cpu, HardDrive,
  Activity, Wifi, ChevronRight, TrendingDown,
  CheckCircle, FolderOpen, Download, RefreshCw,
} from "lucide-react";
import { FileConverter } from "./components/FileConverter";
import { YouTubeDownloader } from "./components/YouTubeDownloader";
import { Compressor } from "./components/Compressor";
import { Switch } from "./components/Switch";
import { NeonSelect } from "./components/NeonSelect";
import { useSettings } from "./useSettings";
import iconUrl from "../assets/proxima-icon.png";
import { api, fmtBytes } from "../lib/media";
import type { AppSettings, HistoryEntry, SystemStats, UpdateStatus } from "../../electron/shared/ipc";

// ─── Types ───────────────────────────────────────────────────────────────────

type Panel = "converter" | "youtube" | "compress" | "history" | "settings";

const TOOLS: {
  id: Panel; label: string; sub: string; icon: React.ReactNode;
}[] = [
  { id: "converter", label: "Converter",   sub: "Audio, Image, & Video", icon: <Film size={15} /> },
  { id: "youtube",   label: "YT Download", sub: "HD Downloader",    icon: <Youtube size={15} /> },
  { id: "compress",  label: "Compressor",  sub: "Reduce File Size", icon: <TrendingDown size={15} /> },
  { id: "history",   label: "History",     sub: "Recent Jobs",      icon: <History size={15} /> },
  { id: "settings",  label: "Settings",    sub: "Preferences",      icon: <Settings size={15} /> },
];

// Single periwinkle-violet accent everywhere (Premiere/Media Encoder brand).
const ACCENT = "#8c7cf0";
const TOOL_ACCENTS: Record<Panel, string> = {
  converter: ACCENT,
  youtube:   ACCENT,
  compress:  ACCENT,
  history:   ACCENT,
  settings:  ACCENT,
};

const s = {
  label: {
    fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
    color: "#b6b6c2", textTransform: "uppercase" as const, letterSpacing: "0.1em",
  },
  mono: { fontFamily: "var(--font-mono)" },
};

function relDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return "Today " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ─── History panel ───────────────────────────────────────────────────────────

function HistoryPanel({ items, onClear, onReveal }: {
  items: HistoryEntry[];
  onClear: () => void;
  onReveal: (path: string) => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-7 pt-7 pb-5 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <h1 style={{ color: "#ebebeb" }}>History</h1>
        <p className="mt-1" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#b6b6c2" }}>
          All conversion, compression, and download jobs — saved across sessions.
        </p>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col px-7 pt-5 pb-0">
        <div
          className="neon flex-1 overflow-hidden flex flex-col rounded-md"
          style={{ border: "1px solid rgba(255,255,255,0.09)", background: "rgba(39,31,58,0.22)" }}
        >
          <div
            className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0"
            style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(31,24,50,0.22)" }}
          >
            <span className="flex-1" style={s.label}>File</span>
            <span className="w-28" style={s.label}>Tool</span>
            <span className="w-32" style={s.label}>Format</span>
            <span className="w-24 text-right" style={s.label}>Size</span>
            <span className="w-20 text-right" style={s.label}>Savings</span>
            <span className="w-28 text-right" style={s.label}>Date</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 h-full opacity-40 py-20">
                <History size={26} style={{ color: "#b6b6c2" }} />
                <p style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#b6b6c2" }}>
                  No jobs yet — your completed conversions and downloads will appear here.
                </p>
              </div>
            ) : items.map((item) => (
              <div
                key={item.id}
                onClick={() => onReveal(item.outputPath)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[rgba(255,255,255,0.02)] cursor-pointer transition-colors"
                title="Reveal in folder"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <CheckCircle size={13} style={{ color: "#3dd68c", flexShrink: 0 }} />
                  <p className="truncate" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#d1d1d1", fontWeight: 500 }}>
                    {item.name}
                  </p>
                </div>
                {(() => {
                  // Color-coded tool tag: Convert = blue, Download (YouTube) =
                  // orange-red, Compress = green.
                  const tool =
                    item.tool === "compress"
                      ? { label: "Compress", fg: "#3dd68c", bg: "rgba(61,214,140,0.12)" }
                      : item.tool === "download"
                      ? { label: "Download", fg: "#8b5cf6", bg: "rgba(139,92,246,0.14)" }
                      : { label: "Convert", fg: "#4ea1ff", bg: "rgba(78,161,255,0.14)" };
                  return (
                    <span
                      className="px-2 py-0.5 rounded-sm inline-flex items-center justify-center"
                      style={{ ...s.mono, fontSize: 11, fontWeight: 700, color: tool.fg, background: tool.bg, width: 112, letterSpacing: "0.04em" }}
                    >
                      {tool.label}
                    </span>
                  );
                })()}
                <div className="w-32 flex items-center gap-1.5">
                  <span style={{ ...s.mono, fontSize: 11, color: "#a0a0ae" }}>{item.from}</span>
                  <ChevronRight size={10} style={{ color: "#9696a4" }} />
                  <span style={{ ...s.mono, fontSize: 11, color: "#c2c2cc" }}>{item.to}</span>
                </div>
                <div className="w-24 text-right">
                  <span style={{ ...s.mono, fontSize: 12, color: "#b6b6c2" }}>{fmtBytes(item.bytes)}</span>
                </div>
                <div className="w-20 text-right">
                  {item.savings != null && (
                    <span className="px-2 py-0.5 rounded-sm" style={{ ...s.mono, fontSize: 11, fontWeight: 700, color: "#3dd68c", background: "rgba(61,214,140,0.1)" }}>
                      −{item.savings}%
                    </span>
                  )}
                </div>
                <div className="w-28 text-right">
                  <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#9696a4" }}>{relDate(item.at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="px-7 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <button
          onClick={onClear}
          disabled={items.length === 0}
          className="neon-btn px-4 py-2 rounded-md disabled:opacity-40"
          style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 500, background: "rgba(50,40,71,0.25)", color: "#cfcfcf" }}
        >
          Clear History
        </button>
      </div>
    </div>
  );
}

// ─── Settings panel ──────────────────────────────────────────────────────────

type Field =
  | { key: keyof AppSettings; label: string; type: "select"; options: string[] }
  | { key: keyof AppSettings; label: string; type: "toggle" }
  | { key: keyof AppSettings; label: string; type: "text"; placeholder?: string }
  | { key: "defaultOutputPath"; label: string; type: "folder" };

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: "Output",
    fields: [
      { key: "defaultOutputPath", label: "Default Output Path", type: "folder" },
      { key: "openPreviewPrompt", label: "Ask to View Result After Conversion", type: "toggle" },
      { key: "autoOpenAfter", label: "Reveal in Folder After Completion", type: "toggle" },
      { key: "overwriteExisting", label: "Overwrite Existing Files", type: "toggle" },
    ],
  },
  {
    title: "Performance",
    fields: [
      { key: "workerThreads", label: "Worker Threads", type: "select", options: ["Auto", "4", "8", "16", "32"] },
      { key: "concurrentDownloads", label: "Concurrent Jobs", type: "select", options: ["1", "2", "4", "8"] },
      { key: "autoRetry", label: "Auto-retry on Fail", type: "toggle" },
    ],
  },
  {
    title: "Network",
    fields: [
      { key: "maxDownloadSpeed", label: "Max Download Speed", type: "select", options: ["Unlimited", "10 MB/s", "50 MB/s", "100 MB/s"] },
    ],
  },
  {
    title: "Interface",
    fields: [
      { key: "uiDensity", label: "UI Density", type: "select", options: ["Compact", "Default", "Relaxed"] },
      { key: "reduceAnimations", label: "Reduce Animations", type: "toggle" },
      { key: "hardwareStatsInBar", label: "Live Hardware Stats in Bar", type: "toggle" },
    ],
  },
];

function SettingsPanel({ settings, update }: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  // Edits collect in a local draft and only persist when "Save" is pressed.
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(settings); }, [settings]);

  const set = (patch: Partial<AppSettings>) => { setSaved(false); setDraft((d) => ({ ...d, ...patch })); };
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const browse = async () => {
    const dir = await api?.pickFolder();
    if (dir) set({ defaultOutputPath: dir });
  };

  const save = () => {
    update(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-start justify-between gap-6 px-7 pt-7 pb-5 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <div>
          <h1 style={{ color: "#ebebeb" }}>Settings</h1>
          <p className="mt-1" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#b6b6c2" }}>
            Adjust your preferences, then hit Save. Settings persist across restarts.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {dirty && <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, color: "#e0a052" }}>Unsaved changes</span>}
          {saved && !dirty && (
            <span className="flex items-center gap-1.5" style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 600, color: "#3dd68c" }}>
              <CheckCircle size={14} /> Saved
            </span>
          )}
          <button
            onClick={save}
            disabled={!dirty}
            className="neon-btn px-5 py-2 rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, fontWeight: 700, background: dirty ? "var(--tool-accent)" : "rgba(50,40,71,0.25)", color: dirty ? "#fff" : "#b6b6c2", border: dirty ? "none" : "1px solid rgba(255,255,255,0.08)", boxShadow: dirty ? "0 2px 12px color-mix(in srgb, var(--tool-accent) 28%, transparent)" : "none" }}
          >
            Save
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-7 py-6">
        <div className="grid grid-cols-2 gap-8 max-w-3xl">
          {SECTIONS.map((sec) => (
            <div key={sec.title}>
              <p style={s.label} className="mb-4">{sec.title}</p>
              <div className="space-y-2.5">
                {sec.fields.map((f) => (
                  <div key={f.key}>
                    {f.type === "toggle" ? (
                      <div
                        className="neon flex items-center justify-between py-2.5 px-4 rounded-md"
                        style={{ background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        <span style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#cfcfcf" }}>{f.label}</span>
                        <Switch
                          checked={Boolean(draft[f.key])}
                          onChange={(v) => set({ [f.key]: v } as Partial<AppSettings>)}
                        />
                      </div>
                    ) : f.type === "select" ? (
                      <div className="px-4 py-2.5 rounded-md" style={{ background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <p style={s.label} className="mb-1.5">{f.label}</p>
                        <NeonSelect
                          value={String(draft[f.key])}
                          options={f.options.map((o) => ({ value: o, label: o }))}
                          onChange={(v) => set({ [f.key]: v } as Partial<AppSettings>)}
                        />
                      </div>
                    ) : f.type === "folder" ? (
                      <div className="neon px-4 py-2.5 rounded-md" style={{ background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <p style={s.label} className="mb-1">{f.label}</p>
                        <div className="flex items-center gap-2">
                          <input
                            value={draft.defaultOutputPath}
                            onChange={(e) => set({ defaultOutputPath: e.target.value })}
                            placeholder="Paste or type a folder…"
                            spellCheck={false}
                            className="flex-1 bg-transparent focus:outline-none"
                            style={{ ...s.mono, fontSize: 12, color: "#c2c2cc" }}
                          />
                          <button
                            onClick={browse}
                            className="neon-btn flex items-center gap-1.5 px-2.5 py-1 rounded-md shrink-0"
                            style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 12, fontWeight: 600, background: "color-mix(in srgb, var(--tool-accent) 12%, transparent)", color: "var(--tool-accent)" }}
                          >
                            <FolderOpen size={12} /> Browse
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="neon px-4 py-2.5 rounded-md" style={{ background: "rgba(39,31,58,0.22)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <p style={s.label} className="mb-1">{f.label}</p>
                        <input
                          value={String(draft[f.key] ?? "")}
                          placeholder={f.placeholder}
                          onChange={(e) => set({ [f.key]: e.target.value } as Partial<AppSettings>)}
                          className="w-full bg-transparent focus:outline-none"
                          style={{ fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif", fontSize: 13, color: "#cfcfcf" }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── App shell ───────────────────────────────────────────────────────────────

export default function App() {
  const [activePanel, setActivePanel] = useState<Panel>("converter");
  const { settings, update } = useSettings();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [appUpdate, setAppUpdate] = useState<UpdateStatus>({ state: "none" });
  const [appVer, setAppVer] = useState("");

  // Responsive scaling — keep the whole layout proportional on any display.
  // The UI is designed at 1280×800; we scale the entire root by the smaller of
  // the width/height ratios so it fills the window identically (same layout,
  // spacing and text) on a small laptop, a 1080p monitor, a 4K screen or a Mac.
  useEffect(() => {
    const BASE_W = 1280;
    const BASE_H = 800;
    const applyZoom = () => {
      const ratio = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
      const zoom = Math.max(0.75, Math.min(1.6, ratio));
      (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(zoom);
    };
    applyZoom();
    window.addEventListener("resize", applyZoom);
    return () => window.removeEventListener("resize", applyZoom);
  }, []);

  // Poll live hardware stats while the bar is enabled.
  useEffect(() => {
    if (!settings.hardwareStatsInBar || !api) return;
    let alive = true;
    const tick = async () => {
      const st = await api!.systemStats();
      if (alive) setStats(st);
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [settings.hardwareStatsInBar]);

  // Subscribe to the auto-update lifecycle and read the running app version once.
  useEffect(() => {
    api?.appVersion().then(setAppVer).catch(() => {});
    return api?.onUpdateStatus(setAppUpdate);
  }, []);

  const refreshHistory = useCallback(async () => {
    const list = (await api?.historyList()) ?? [];
    setHistory(list);
  }, []);

  useEffect(() => { refreshHistory(); }, [refreshHistory]);
  useEffect(() => { if (activePanel === "history") refreshHistory(); }, [activePanel, refreshHistory]);

  const clearHistory = useCallback(async () => {
    await api?.historyClear();
    setHistory([]);
  }, []);

  return (
    <div
      className="flex flex-col size-full overflow-hidden"
      style={{ fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif", background: "transparent", WebkitFontSmoothing: "antialiased", ["--tool-accent" as string]: TOOL_ACCENTS[activePanel] } as React.CSSProperties}
    >
      {/* ══ Application menu bar — Figma NLE style (translucent over gradient) ══ */}
      <div
        className="neon flex items-center shrink-0 mx-3 mt-2 mb-1 rounded-2xl"
        style={{ background: "rgba(16,12,28,0.5)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", height: 42 }}
      >
        {/* Compact logo mark */}
        <div className="flex items-center px-3 shrink-0">
          <img src={iconUrl} alt="Proxima Studio" style={{ height: 30, width: "auto", objectFit: "contain", borderRadius: 7, display: "block" }} />
        </div>

        <div className="flex-1" />

        {/* Update indicator — appears when a newer published version is found.
            Click to download, then click again to restart-and-install. */}
        {appUpdate.state !== "none" && appUpdate.state !== "error" && (
          <button
            onClick={() => {
              if (appUpdate.state === "available") api?.downloadUpdate();
              else if (appUpdate.state === "ready") api?.installUpdate();
            }}
            disabled={appUpdate.state === "downloading"}
            className="neon-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg shrink-0 mr-2 disabled:opacity-70"
            style={{ ...s.mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", background: "color-mix(in srgb, var(--tool-accent) 26%, transparent)", color: "#fff", border: "1px solid color-mix(in srgb, var(--tool-accent) 50%, transparent)", boxShadow: "0 0 10px color-mix(in srgb, var(--tool-accent) 30%, transparent)" }}
            title={appUpdate.state === "ready" ? "Restart to finish updating" : appUpdate.state === "downloading" ? "Downloading update…" : `Version ${appUpdate.version} is available`}
          >
            {appUpdate.state === "ready" ? <RefreshCw size={11} /> : <Download size={11} />}
            {appUpdate.state === "available" && `Update to v${appUpdate.version}`}
            {appUpdate.state === "downloading" && `Updating… ${appUpdate.percent ?? 0}%`}
            {appUpdate.state === "ready" && "Restart to update"}
          </button>
        )}

        {/* Live hardware HUD — NLE mono style */}
        {settings.hardwareStatsInBar && (
          <div className="flex items-center gap-4 px-4 shrink-0">
            {[
              { icon: <Cpu size={9} />,       val: stats ? `CPU ${stats.cpu}%` : "CPU …" },
              { icon: <Activity size={9} />,  val: stats ? (stats.gpu < 0 ? "GPU n/a" : `GPU ${stats.gpu}%`) : "GPU …" },
              { icon: <HardDrive size={9} />, val: stats ? `${fmtBytes(stats.diskFree)}` : "DISK …" },
            ].map((stat, i) => (
              <div key={i} className="flex items-center gap-1.5" style={{ ...s.mono, fontSize: 11, color: "#b6b6c2" }}>
                {stat.icon} {stat.val}
              </div>
            ))}
            <div className="w-px h-3" style={{ background: "rgba(255,255,255,0.1)" }} />
            <div className="flex items-center gap-1.5" style={{ ...s.mono, fontSize: 11, color: "#4a9e6a" }}>
              <Wifi size={9} /> ONLINE
            </div>
          </div>
        )}
      </div>

      {/* ══ Workspace tab bar — glowing neon segmented pill ══ */}
      <div className="shrink-0 px-4 py-2.5">
        <div className="tabbar">
          {TOOLS.map((tool) => {
            const active = activePanel === tool.id;
            const accent = TOOL_ACCENTS[tool.id];
            return (
              <button
                key={tool.id}
                onClick={() => setActivePanel(tool.id)}
                data-active={active}
                className="tabbtn flex-1"
              >
                <span style={{ color: active ? accent : "currentColor", display: "flex" }}>{tool.icon}</span>
                <span style={{ ...s.mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: "currentColor", whiteSpace: "nowrap" }}>
                  {tool.label.toUpperCase()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ══ Main workspace ══ */}
      <div className="flex-1 overflow-hidden" style={{ background: "transparent" }}>
        {/* The three tool panels stay mounted (shown/hidden, not unmounted) so a
            conversion, a compression and a YouTube fetch can all run at the same
            time — switching tabs never drops an in-flight job or its progress.
            History/Settings are cheap and render on demand. */}
        <div className="h-full" style={{ display: activePanel === "converter" ? "block" : "none" }}>
          <FileConverter settings={settings} onJobDone={refreshHistory} />
        </div>
        <div className="h-full" style={{ display: activePanel === "youtube" ? "block" : "none" }}>
          <YouTubeDownloader settings={settings} onJobDone={refreshHistory} />
        </div>
        <div className="h-full" style={{ display: activePanel === "compress" ? "block" : "none" }}>
          <Compressor settings={settings} onJobDone={refreshHistory} />
        </div>
        {activePanel === "history"   && <HistoryPanel items={history} onClear={clearHistory} onReveal={(p) => api?.showInFolder(p)} />}
        {activePanel === "settings"  && <SettingsPanel settings={settings} update={update} />}
      </div>

      {/* ══ Status bar — Figma NLE info strip ══ */}
      <div
        className="flex items-center justify-between px-4 shrink-0 border-t"
        style={{ background: "rgba(19,15,29,0.32)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderColor: "rgba(255,255,255,0.08)", height: 22 }}
      >
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5" style={{ background: "#4a9e6a" }} />
            <span style={{ ...s.mono, fontSize: 11, color: "#b6b6c2", letterSpacing: "0.1em" }}>ENGINE READY</span>
          </div>
          {settings.hardwareStatsInBar && stats && (
            <span style={{ ...s.mono, fontSize: 11, color: "#a0a0ae" }}>
              {stats.cpuModel} · {stats.cores} cores · {fmtBytes(stats.memTotal)} RAM
            </span>
          )}
        </div>
        <span style={{ ...s.mono, fontSize: 11, color: "var(--tool-accent)", letterSpacing: "0.1em", fontWeight: 700 }}>
          PROXIMA STUDIO · PROFESSIONAL EDITION · v{appVer || "0.1.0"}
        </span>
      </div>
    </div>
  );
}
