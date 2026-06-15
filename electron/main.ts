import { app, BrowserWindow, dialog, ipcMain, shell, nativeImage } from 'electron';
import electronUpdater from 'electron-updater';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, extname, normalize } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { statfs, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { convert, cancelConvert } from './services/converter.js';
import { probe as previewProbe, frame as previewFrame } from './services/preview.js';
import { download, getInfo } from './services/downloader.js';
import { loadSettings, saveSettings } from './services/settings.js';
import { listHistory, addHistory, clearHistory, removeHistory } from './services/history.js';
import { IPC } from './shared/ipc.js';
import type {
  ConvertRequest,
  DownloadRequest,
  JobProgress,
  AppSettings,
  WinAction,
  UpdateStatus,
} from './shared/ipc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;

/** Resolve a bundled asset (icon/splash) in both dev and packaged builds. */
function assetPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'build', name);
}

/**
 * The window/taskbar icon. On Windows the running app's taskbar button needs a
 * real multi-size .ico to render the transparent Proxima logo crisply — a large
 * .png gets ignored or flattened (showing the default Electron icon / a solid
 * square). Other platforms take the transparent .png.
 */
function appIcon() {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return nativeImage.createFromPath(assetPath(file));
}

function emitProgress(p: JobProgress) {
  win?.webContents.send(IPC.onProgress, p);
}

/** Frameless splash that flashes the Proxima logo while the app boots. */
function createSplash() {
  let imgTag = '';
  try {
    const b64 = readFileSync(assetPath('splash.png')).toString('base64');
    imgTag = `<img src="data:image/png;base64,${b64}" alt="Proxima Studios" />`;
  } catch {
    imgTag = '<div class="fallback">PROXIMA STUDIOS</div>';
  }

  splash = new BrowserWindow({
    width: 620,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { contextIsolation: true },
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:transparent;overflow:hidden;
      font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;}
    .card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:22px;background:#0f0f12;border-radius:20px;
      border:1px solid rgba(255,255,255,0.08);box-shadow:0 24px 80px rgba(0,0,0,0.6);
      animation:fade .4s ease both;}
    img{width:480px;max-width:82%;height:auto;filter:drop-shadow(0 8px 40px rgba(99,102,241,0.45));
      animation:pop .6s cubic-bezier(.2,.8,.2,1) both;}
    .fallback{color:#e8e8ea;font-size:28px;font-weight:700;letter-spacing:.08em;}
    .bar{width:200px;height:3px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;}
    .bar>span{display:block;height:100%;width:40%;border-radius:3px;
      background:linear-gradient(90deg,#6366f1,#a855f7);animation:slide 1.1s ease-in-out infinite;}
    @keyframes pop{from{transform:scale(.82);opacity:0}to{transform:scale(1);opacity:1}}
    @keyframes fade{from{opacity:0}to{opacity:1}}
    @keyframes slide{0%{transform:translateX(-120%)}100%{transform:translateX(360%)}}
  </style></head><body><div class="card">${imgTag}<div class="bar"><span></span></div></div></body></html>`;

  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  splash.once('ready-to-show', () => splash?.show());
}

/** Map the UI "Max Download Speed" label to a yt-dlp --limit-rate value. */
function rateFromSetting(label: string): string | undefined {
  const m = label.match(/(\d+)\s*MB/i);
  return m ? `${m[1]}M` : undefined;
}

function threadsFromSetting(label: string): number {
  const n = Number(label);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// CPU usage is a delta between samples, so we keep the previous totals.
function cpuSample(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}
let prevCpu = cpuSample();

// GPU utilization is sampled on its own slower loop (typeperf is slow) and
// cached so the main stats poll stays snappy. -1 means "unavailable".
let gpuPercent = -1;
function sampleGpu() {
  if (process.platform !== 'win32') return;
  try {
    const proc = spawn('typeperf', ['\\GPU Engine(*engtype_3D)\\Utilization Percentage', '-sc', '1']);
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('error', () => { /* typeperf missing — leave previous value */ });
    proc.on('close', () => {
      const lines = out.trim().split(/\r?\n/).filter((l) => l.startsWith('"'));
      if (lines.length < 2) return;
      const cols = lines[lines.length - 1].split('","').map((c) => c.replace(/"/g, ''));
      let sum = 0;
      for (let i = 1; i < cols.length; i++) {
        const v = parseFloat(cols[i]);
        if (!Number.isNaN(v)) sum += v;
      }
      gpuPercent = Math.max(0, Math.min(100, Math.round(sum)));
    });
  } catch {
    /* leave previous value */
  }
}

async function readStats() {
  const now = cpuSample();
  const idleDiff = now.idle - prevCpu.idle;
  const totalDiff = now.total - prevCpu.total;
  prevCpu = now;
  const cpu = totalDiff > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100))) : 0;

  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();

  let diskFree = 0;
  let diskTotal = 0;
  try {
    const fsStat = await statfs(os.homedir());
    diskTotal = fsStat.blocks * fsStat.bsize;
    diskFree = fsStat.bavail * fsStat.bsize;
  } catch {
    // statfs unavailable; leave disk values at 0.
  }

  const cpus = os.cpus();
  return {
    cpu,
    gpu: gpuPercent,
    memUsed,
    memTotal,
    diskFree,
    diskTotal,
    cpuModel: cpus[0]?.model?.trim() ?? 'CPU',
    cores: cpus.length,
    platform: `${os.platform()} ${os.release()}`,
  };
}

function createWindow() {
  const splashShownAt = Date.now();
  const MIN_SPLASH_MS = 1500;

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#120d1e',
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // The app ships its own in-window menu bar; hide the native one.
  win.setMenuBarVisibility(false);
  // Force the live taskbar button to adopt our transparent icon (Windows
  // otherwise caches the launching electron.exe icon for dev runs).
  if (process.platform === 'win32') win.setIcon(appIcon());

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'));
  }

  // Keep the splash up for a brief, deliberate flash, then reveal the app.
  win.once('ready-to-show', () => {
    const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - splashShownAt));
    setTimeout(() => {
      splash?.close();
      splash = null;
      win?.show();
      if (devUrl) win?.webContents.openDevTools({ mode: 'detach' });
    }, wait);
  });
}

// electron-updater is CJS; under ESM bundling the class lives on `.default`.
const { autoUpdater } = electronUpdater;

const UPDATE_REPO = 'Gomby711/proxima-studio';
let macDownloadUrl = '';

/** Push the current update lifecycle state to the renderer's update indicator. */
function emitUpdate(s: UpdateStatus) {
  win?.webContents.send(IPC.onUpdate, s);
}

/** "a is a newer version than b" (numeric major.minor.patch compare). */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * FREE macOS update check (no paid Apple Developer ID). Squirrel.Mac refuses to
 * auto-install unsigned updates, so instead we poll GitHub's "latest release"
 * API, compare versions, and — if a newer one exists — show the update indicator
 * whose button opens the release page in the browser for a manual download.
 */
async function checkMacUpdate() {
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Proxima-Studio' },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = String(data.tag_name ?? '').replace(/^v/, '');
    if (latest && isNewerVersion(latest, app.getVersion())) {
      macDownloadUrl = data.html_url ?? `https://github.com/${UPDATE_REPO}/releases/latest`;
      emitUpdate({ state: 'available', version: latest, manual: true, downloadUrl: macDownloadUrl });
    } else {
      emitUpdate({ state: 'none' });
    }
  } catch {
    /* offline — retry on the next interval */
  }
}

/**
 * Update lifecycle. Only runs in a packaged build (dev has no feed).
 * - Windows/Linux: real in-app auto-update via electron-updater + GitHub Releases.
 * - macOS: free notify-and-open-download flow (see checkMacUpdate) since unsigned
 *   apps can't auto-install.
 */
function setupAutoUpdate() {
  if (!app.isPackaged) return;

  if (process.platform === 'darwin') {
    checkMacUpdate();
    setInterval(checkMacUpdate, 6 * 60 * 60 * 1000);
    return;
  }

  autoUpdater.autoDownload = false;          // wait for the user to click "Update"
  autoUpdater.autoInstallOnAppQuit = true;   // if downloaded, also install on next quit

  autoUpdater.on('update-available', (info) => emitUpdate({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => emitUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => emitUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => emitUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => emitUpdate({ state: 'error', message: String(err) }));

  // Check shortly after launch, then every 6 hours while the app is open.
  autoUpdater.checkForUpdates().catch(() => { /* offline / no release yet */ });
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  // Group windows under our own identity so Windows shows the Proxima Studio
  // icon (not the generic Electron one) on the taskbar, Start, and Alt-Tab.
  if (process.platform === 'win32') app.setAppUserModelId('com.proxima.studio');
  createSplash();
  createWindow();
  setupAutoUpdate();
  sampleGpu();
  setInterval(sampleGpu, 3000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC handlers -------------------------------------------------------

/** The window a dialog should attach to — prefer focused, fall back to main. */
function dialogParent(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  if (win && !win.isDestroyed()) return win;
  return null;
}

ipcMain.handle(IPC.pickFiles, async () => {
  try {
    const parent = dialogParent();
    const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'] };
    const r = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts);
    return r.canceled ? [] : r.filePaths;
  } catch (err) {
    console.error('pickFiles failed', err);
    return [];
  }
});

ipcMain.handle(IPC.pickFolder, async () => {
  try {
    const parent = dialogParent();
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const r = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts);
    return r.canceled ? null : r.filePaths[0];
  } catch (err) {
    console.error('pickFolder failed', err);
    return null;
  }
});

type PickSaveOpts = {
  defaultName?: string;
  defaultDir?: string;
  filters?: { name: string; extensions: string[] }[];
};

/** The default destination folder, HandBrake-style: saved setting else ~/Videos. */
async function resolveDefaultOutputDir(): Promise<string> {
  const settings = await loadSettings();
  return settings.defaultOutputPath?.trim() || app.getPath('videos');
}

ipcMain.handle(IPC.defaultDir, async () => resolveDefaultOutputDir());

ipcMain.handle(IPC.saveAs, async (_e, srcPath: string) => {
  try {
    if (!srcPath) return null;
    const parent = dialogParent();
    const defaultPath = join(await resolveDefaultOutputDir(), basename(srcPath));
    const dlgOpts: Electron.SaveDialogOptions = {
      title: 'Save a copy as',
      defaultPath,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const r = parent
      ? await dialog.showSaveDialog(parent, dlgOpts)
      : await dialog.showSaveDialog(dlgOpts);
    if (r.canceled || !r.filePath) return null;
    await copyFile(srcPath, r.filePath);
    return r.filePath;
  } catch (err) {
    console.error('saveAs failed', err);
    return null;
  }
});

ipcMain.handle(IPC.pickSave, async (_e, opts?: PickSaveOpts) => {
  try {
    const parent = dialogParent();
    const dir = opts?.defaultDir || (await resolveDefaultOutputDir());
    const defaultPath = opts?.defaultName ? join(dir, opts.defaultName) : dir;
    const dlgOpts: Electron.SaveDialogOptions = {
      title: 'Save converted file as',
      defaultPath,
      filters: opts?.filters,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const r = parent
      ? await dialog.showSaveDialog(parent, dlgOpts)
      : await dialog.showSaveDialog(dlgOpts);
    return r.canceled || !r.filePath ? null : r.filePath;
  } catch (err) {
    console.error('pickSave failed', err);
    return null;
  }
});

ipcMain.handle(IPC.convert, async (_e, req: ConvertRequest) => {
  const jobId = req.jobId ?? randomUUID();
  const settings = await loadSettings();
  // HandBrake-style destination: explicit dir → saved default → ~/Videos.
  const outputDir = req.outputDir || settings.defaultOutputPath || app.getPath('videos');
  const result = await convert(
    jobId,
    {
      ...req,
      outputDir,
      overwrite: req.overwrite ?? settings.overwriteExisting,
      threads: req.threads ?? threadsFromSetting(settings.workerThreads),
    },
    emitProgress,
  );

  const inExt = extname(req.inputPath).slice(1).toUpperCase();
  const tool = req.tool ?? 'convert';
  const savings =
    tool === 'compress' && req.originalBytes && req.originalBytes > 0 && result.bytes > 0
      ? Math.max(0, Math.round((1 - result.bytes / req.originalBytes) * 100))
      : undefined;
  await addHistory({
    id: jobId,
    name: basename(result.outputPath),
    tool,
    from: inExt || '—',
    to: req.targetFormat.toUpperCase(),
    bytes: result.bytes,
    savings,
    at: new Date().toISOString(),
    outputPath: result.outputPath,
  });
  if (settings.autoOpenAfter) shell.showItemInFolder(result.outputPath);
  return result;
});

ipcMain.handle(IPC.download, async (_e, req: DownloadRequest) => {
  const jobId = req.jobId ?? randomUUID();
  const settings = await loadSettings();
  const binDir = app.getPath('userData');
  // Honour the saved default output folder, else fall back to ~/Videos (same as
  // conversions) so a download always lands in a real, revealable folder.
  const outputDir = req.outputDir || settings.defaultOutputPath || app.getPath('videos');
  const result = await download(
    jobId,
    {
      ...req,
      outputDir,
      limitRate: req.limitRate ?? rateFromSetting(settings.maxDownloadSpeed),
    },
    binDir,
    emitProgress,
  );

  await addHistory({
    id: jobId,
    name: result.title,
    tool: 'download',
    from: result.source.toUpperCase(),
    to: (req.format ?? (req.audioOnly ? 'MP3' : 'MP4')).toUpperCase(),
    bytes: result.bytes,
    at: new Date().toISOString(),
    outputPath: result.outputPath,
  });
  if (settings.autoOpenAfter && result.outputPath) shell.showItemInFolder(result.outputPath);
  return result;
});

ipcMain.handle(IPC.previewInfo, async (_e, path: string) => previewProbe(path));
ipcMain.handle(IPC.previewFrame, async (_e, path: string, atSeconds: number) => previewFrame(path, atSeconds));

ipcMain.handle(IPC.getInfo, async (_e, url: string) => {
  return getInfo(url, app.getPath('userData'));
});

ipcMain.handle(IPC.cancel, async (_e, jobId: string) => {
  cancelConvert(jobId);
});

ipcMain.handle(IPC.settingsGet, async () => loadSettings());
ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<AppSettings>) => saveSettings(patch));

ipcMain.handle(IPC.historyList, async () => listHistory());
ipcMain.handle(IPC.historyClear, async () => clearHistory());
ipcMain.handle(IPC.historyRemove, async (_e, id: string) => { await removeHistory(id); });

ipcMain.handle(IPC.openPath, async (_e, path: string) => {
  if (path) await shell.openPath(path);
});
ipcMain.handle(IPC.showInFolder, async (_e, p: string) => {
  if (!p) return;
  // Normalise separators (yt-dlp/ffmpeg can emit forward slashes on Windows) so
  // Explorer reliably reveals the exact file. If the file itself is gone, open
  // its containing folder instead so the button never silently does nothing.
  const target = normalize(p);
  if (existsSync(target)) {
    shell.showItemInFolder(target);
  } else {
    const dir = dirname(target);
    if (existsSync(dir)) await shell.openPath(dir);
  }
});

ipcMain.handle(IPC.sysStats, async () => readStats());

// ---- Auto-update -----------------------------------------------------------

ipcMain.handle(IPC.appVersion, async () => app.getVersion());
ipcMain.handle(IPC.updateCheck, async () => {
  if (process.platform === 'darwin') return checkMacUpdate();
  try { await autoUpdater.checkForUpdates(); } catch { /* offline / no feed yet */ }
});
ipcMain.handle(IPC.updateDownload, async () => {
  // macOS (unsigned): no in-app install — open the release page to download.
  if (process.platform === 'darwin') {
    await shell.openExternal(macDownloadUrl || `https://github.com/${UPDATE_REPO}/releases/latest`);
    return;
  }
  try { await autoUpdater.downloadUpdate(); }
  catch (err) { emitUpdate({ state: 'error', message: String(err) }); }
});
ipcMain.handle(IPC.updateInstall, async () => {
  if (process.platform === 'darwin') return;
  autoUpdater.quitAndInstall();
});

ipcMain.handle(IPC.win, async (_e, action: WinAction) => {
  if (!win) return;
  switch (action) {
    case 'minimize': win.minimize(); break;
    case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
    case 'close': win.close(); break;
    case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
    case 'reload': win.webContents.reload(); break;
    case 'devtools': win.webContents.toggleDevTools(); break;
    case 'quit': app.quit(); break;
  }
});
