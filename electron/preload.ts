import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from './shared/ipc.js';
import type {
  ConvertRequest,
  DownloadRequest,
  JobProgress,
  ProximaApi,
  AppSettings,
  WinAction,
  UpdateStatus,
} from './shared/ipc.js';

// The ONLY surface the renderer can touch. Everything is funnelled through
// these typed methods — the renderer never gets raw ipcRenderer or Node access.
const api: ProximaApi = {
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  pickSavePath: (opts?: { defaultName?: string; defaultDir?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke(IPC.pickSave, opts),
  defaultOutputDir: () => ipcRenderer.invoke(IPC.defaultDir),
  saveCopy: (srcPath: string) => ipcRenderer.invoke(IPC.saveAs, srcPath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  convert: (req: ConvertRequest) => ipcRenderer.invoke(IPC.convert, req),
  previewInfo: (path: string) => ipcRenderer.invoke(IPC.previewInfo, path),
  previewFrame: (path: string, atSeconds: number) => ipcRenderer.invoke(IPC.previewFrame, path, atSeconds),
  download: (req: DownloadRequest) => ipcRenderer.invoke(IPC.download, req),
  getInfo: (url: string) => ipcRenderer.invoke(IPC.getInfo, url),
  cancel: (jobId: string) => ipcRenderer.invoke(IPC.cancel, jobId),
  onProgress: (cb: (p: JobProgress) => void) => {
    const listener = (_e: unknown, p: JobProgress) => cb(p);
    ipcRenderer.on(IPC.onProgress, listener);
    return () => ipcRenderer.removeListener(IPC.onProgress, listener);
  },
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsSet, patch),
  historyList: () => ipcRenderer.invoke(IPC.historyList),
  historyClear: () => ipcRenderer.invoke(IPC.historyClear),
  historyRemove: (id: string) => ipcRenderer.invoke(IPC.historyRemove, id),
  openPath: (path: string) => ipcRenderer.invoke(IPC.openPath, path),
  showInFolder: (path: string) => ipcRenderer.invoke(IPC.showInFolder, path),
  win: (action: WinAction) => ipcRenderer.invoke(IPC.win, action),
  systemStats: () => ipcRenderer.invoke(IPC.sysStats),
  appVersion: () => ipcRenderer.invoke(IPC.appVersion),
  checkForUpdate: () => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => {
    const listener = (_e: unknown, s: UpdateStatus) => cb(s);
    ipcRenderer.on(IPC.onUpdate, listener);
    return () => ipcRenderer.removeListener(IPC.onUpdate, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
