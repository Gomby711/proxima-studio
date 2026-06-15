// Shared IPC contract — imported by BOTH main and preload/renderer.
// Keeping it in one place means the typed `window.api` surface in the renderer
// can never drift from what the main process actually implements.

export type MediaKind = 'image' | 'video' | 'audio';

export interface ConvertRequest {
  /** Renderer-supplied id so progress events can be routed back to a job row. */
  jobId?: string;
  inputPath: string;
  /** Target container/extension without the dot, e.g. 'mp4', 'png', 'webp'. */
  targetFormat: string;
  /** Optional output dir; defaults to the input file's folder. */
  outputDir?: string;
  /** Exact output file path (dir + name + ext). Overrides outputDir/auto-name. */
  outputPath?: string;
  /** Quality preset the UI exposes; mapped to ffmpeg args in the service. */
  quality?: 'low' | 'medium' | 'high' | 'lossless';
  /** Overwrite an existing output file. Defaults to true. */
  overwrite?: boolean;
  /** ffmpeg worker thread count (0 = auto). */
  threads?: number;
  /** Preferred video codec label from the UI, e.g. 'H.264', 'H.265', 'VP9'. */
  vcodec?: string;
  /** Output frame rate, e.g. '24', '30', '60'. */
  fps?: string;
  /** How to log this job in history; affects savings calc. Defaults to 'convert'. */
  tool?: 'convert' | 'compress';
  /** Original input size in bytes, used to compute compression savings. */
  originalBytes?: number;
}

export interface ConvertResult {
  outputPath: string;
  bytes: number;
  durationMs: number;
}

export type DownloadSource = 'youtube' | 'instagram' | 'auto';

/**
 * Post-download polish applied to YouTube pulls. Subtitle-embedding and
 * chapter-splitting are handled natively by yt-dlp; the audio/metadata options
 * run as a follow-up ffmpeg pass over the finished file.
 */
export interface PostProcessOptions {
  /** Embed a subtitle track (downloaded + auto-generated) into the file. */
  embedSubs?: boolean;
  /** Loudness-normalise the audio (EBU R128 via ffmpeg loudnorm). */
  normalizeAudio?: boolean;
  /** Strip all metadata/tags from the output file. */
  removeMetadata?: boolean;
  /** Remove leading/trailing/inter-clip silence (ffmpeg silenceremove). */
  trimSilence?: boolean;
  /** Split the download into one file per YouTube chapter, when present. */
  splitByChapter?: boolean;
}

export interface DownloadRequest {
  /** Renderer-supplied id so progress events can be routed back to a job row. */
  jobId?: string;
  url: string;
  outputDir: string;
  /** Optional base filename (no extension) the user typed via "Browse". */
  outputName?: string;
  /** Max height for the HD pull, e.g. 1080, 720. Falls back to best available. */
  maxHeight?: 2160 | 1440 | 1080 | 720 | 480;
  /** Pull audio only (m4a) instead of muxed video. */
  audioOnly?: boolean;
  /** Container to mux/convert into, e.g. 'mp4', 'mkv', 'mp3'. */
  format?: string;
  /** Cap transfer rate, e.g. '10M', '50M'. Maps to yt-dlp --limit-rate. */
  limitRate?: string;
  /** Optional post-download processing toggles (subtitles, audio, chapters…). */
  postProcess?: PostProcessOptions;
}

export interface DownloadResult {
  outputPath: string;
  title: string;
  source: DownloadSource;
  bytes: number;
}

/** Source media dimensions/duration, used by the live preview scrubber. */
export interface MediaInfo {
  durationSeconds: number;
  width: number;
  height: number;
}

/** Lightweight metadata returned by the "Analyze" step. */
export interface VideoInfo {
  title: string;
  channel: string;
  durationSeconds: number;
  durationLabel: string;
  viewCount: number;
  likeCount: number;
  thumbnail: string;
  source: DownloadSource;
}

/** Progress events stream from main -> renderer on a single channel. */
export interface JobProgress {
  jobId: string;
  /** 0..1, or -1 when indeterminate. */
  percent: number;
  stage: string;
}

// ---- Persistent settings -------------------------------------------------

export interface AppSettings {
  // Output
  defaultOutputPath: string;
  autoOpenAfter: boolean;       // reveal output in folder after completion
  overwriteExisting: boolean;   // ffmpeg -y vs -n
  openPreviewPrompt: boolean;   // show "view result" popup after conversion
  // Performance
  workerThreads: string;        // ffmpeg -threads
  concurrentDownloads: string;  // batch concurrency
  autoRetry: boolean;           // retry a failed job once
  // Network
  maxDownloadSpeed: string;     // yt-dlp --limit-rate
  // Interface
  uiDensity: string;            // root font size
  reduceAnimations: boolean;    // disable transitions/animations
  hardwareStatsInBar: boolean;  // show live CPU/MEM/DISK in title bar
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultOutputPath: '',
  autoOpenAfter: false,
  overwriteExisting: true,
  openPreviewPrompt: true,
  workerThreads: 'Auto',
  concurrentDownloads: '2',
  autoRetry: true,
  maxDownloadSpeed: 'Unlimited',
  uiDensity: 'Default',
  reduceAnimations: false,
  hardwareStatsInBar: true,
};

/** Live system stats shown in the title bar. */
export interface SystemStats {
  cpu: number;       // 0..100 (%)
  gpu: number;       // 0..100 (%), -1 if unavailable
  memUsed: number;   // bytes
  memTotal: number;  // bytes
  diskFree: number;  // bytes
  diskTotal: number; // bytes
  cpuModel: string;
  cores: number;
  platform: string;
}

// ---- History -------------------------------------------------------------

export type HistoryTool = 'convert' | 'compress' | 'download';

export interface HistoryEntry {
  id: string;
  name: string;
  tool: HistoryTool;
  from: string;
  to: string;
  /** Output size in bytes. */
  bytes: number;
  /** Percent saved (compression only). */
  savings?: number;
  /** ISO timestamp. */
  at: string;
  outputPath: string;
}

// ---- Auto-update ---------------------------------------------------------

/** Streamed from main -> renderer so the UI can show an update indicator. */
export interface UpdateStatus {
  /**
   * none        — up to date / not yet checked
   * available   — a newer version exists (offer to download)
   * downloading — update is downloading (percent set)
   * ready       — downloaded; restart to install
   * error       — check/download failed (message set)
   */
  state: 'none' | 'available' | 'downloading' | 'ready' | 'error';
  /** The new version, when available/ready. */
  version?: string;
  /** Download progress 0..100, when downloading. */
  percent?: number;
  /** Error detail, when state === 'error'. */
  message?: string;
  /** macOS (unsigned): can't auto-install, so the update is a manual download. */
  manual?: boolean;
  /** Release/download page to open in the browser for a manual update (macOS). */
  downloadUrl?: string;
}

// ---- IPC channel names — referenced from both sides, never as literals -----

export const IPC = {
  pickFiles: 'dialog:pickFiles',
  pickFolder: 'dialog:pickFolder',
  pickSave: 'dialog:pickSave',
  saveAs: 'fs:saveAs',
  defaultDir: 'app:defaultDir',
  convert: 'media:convert',
  previewInfo: 'media:previewInfo',
  previewFrame: 'media:previewFrame',
  download: 'media:download',
  getInfo: 'media:getInfo',
  cancel: 'job:cancel',
  onProgress: 'job:progress',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  historyList: 'history:list',
  historyClear: 'history:clear',
  historyRemove: 'history:remove',
  openPath: 'shell:openPath',
  showInFolder: 'shell:showInFolder',
  win: 'window:control',
  reveal: 'window:reveal',
  sysStats: 'system:stats',
  appVersion: 'app:version',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  onUpdate: 'update:status',
} as const;

/** Window/menu control verbs sent over the `win` channel. */
export type WinAction =
  | 'minimize'
  | 'maximize'
  | 'close'
  | 'fullscreen'
  | 'reload'
  | 'devtools'
  | 'quit';

/** The exact shape exposed on `window.api` by the preload bridge. */
export interface ProximaApi {
  pickFiles(): Promise<string[]>;
  pickFolder(): Promise<string | null>;
  /** "Save As" dialog — pick a destination folder AND name the output file. */
  pickSavePath(opts?: {
    defaultName?: string;
    defaultDir?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
  /** The default destination folder (saved setting, else the user's Videos folder). */
  defaultOutputDir(): Promise<string>;
  /** "Download" a finished file: Save-As dialog, then copy. Returns the new path or null. */
  saveCopy(srcPath: string): Promise<string | null>;
  /** Resolve the absolute path of a File from a drop/input (Electron webUtils). */
  getPathForFile(file: File): string;
  convert(req: ConvertRequest): Promise<ConvertResult>;
  /** Probe a source file for duration/resolution (for the live preview scrubber). */
  previewInfo(path: string): Promise<MediaInfo>;
  /** Extract one frame at `atSeconds` as a JPEG data URL (HandBrake-style preview). */
  previewFrame(path: string, atSeconds: number): Promise<string>;
  download(req: DownloadRequest): Promise<DownloadResult>;
  getInfo(url: string): Promise<VideoInfo>;
  cancel(jobId: string): Promise<void>;
  onProgress(cb: (p: JobProgress) => void): () => void;
  settingsGet(): Promise<AppSettings>;
  settingsSet(patch: Partial<AppSettings>): Promise<AppSettings>;
  historyList(): Promise<HistoryEntry[]>;
  historyClear(): Promise<void>;
  /** Permanently remove a single history entry by id. */
  historyRemove(id: string): Promise<void>;
  openPath(path: string): Promise<void>;
  showInFolder(path: string): Promise<void>;
  win(action: WinAction): Promise<void>;
  systemStats(): Promise<SystemStats>;
  /** This app's version string (from package.json), e.g. "1.0.0". */
  appVersion(): Promise<string>;
  /** Manually trigger an update check (auto-checked on launch + periodically). */
  checkForUpdate(): Promise<void>;
  /** Download an available update (progress streams via onUpdateStatus). */
  downloadUpdate(): Promise<void>;
  /** Quit and install a downloaded update. */
  installUpdate(): Promise<void>;
  /** Subscribe to update lifecycle events; returns an unsubscribe fn. */
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
}
