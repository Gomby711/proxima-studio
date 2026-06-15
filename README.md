# Proxima Studio

Desktop app for **pic & video file conversion** plus **HD downloads** from YouTube / Instagram links.

## Stack
- **Electron** (main process) — filesystem + spawns `ffmpeg` / `yt-dlp`
- **React + Vite + TypeScript** (renderer) — the UI
- IPC bridge via a sandboxed `preload` script (`contextIsolation: true`)

## Structure
```
electron/
  main.ts            Electron entry, window + IPC handlers
  preload.ts         The only main<->renderer bridge (window.api)
  shared/ipc.ts      Typed IPC contract shared by both sides
  services/
    converter.ts     ffmpeg-static conversion (image/video/audio)
    downloader.ts    yt-dlp HD downloads (YouTube/Instagram)
src/
  index.css          Tailwind v4 entry + fonts + theme import
  styles/theme.css   Design tokens (copied from Figma — Premiere-Pro dark)
  app/
    App.tsx          Main shell: menu bar, tool rail, tabs, timeline, status
    components/      FileConverter, YouTubeDownloader, History/Settings,
                     PanelHeader, FilmStrip, WaveformBar
```

## Develop
```bash
npm install
npm run dev      # Vite + Electron with hot reload
npm run build    # Production build + installer (electron-builder)
```

## Design status
The UI is an **exact copy** of the Figma Make file "Professional Graphic Design
App" (Premiere-Pro-inspired dark theme, JetBrains Mono, Tailwind v4 tokens).

The screens currently drive **mock** conversion/download progress (as in the
Figma source). The real engine lives in `electron/services/` and is exposed on
`window.api`; the next step is wiring the panels' actions to it.
