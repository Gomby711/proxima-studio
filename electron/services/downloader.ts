import { join, dirname, basename, extname } from 'node:path';
import { stat, mkdir, rename, unlink } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { ffmpegPath } from './ffmpeg.js';
import YTDlpWrapModule from 'yt-dlp-wrap';

// yt-dlp-wrap is CommonJS (`exports.default = class`). Under ESM bundling the
// default import resolves to the module namespace, so the actual constructor
// lives at `.default`. Without unwrapping it, `new YTDlpWrap()` throws
// "is not a constructor" and every YouTube action fails silently.
const YTDlpWrap = (
  (YTDlpWrapModule as unknown as { default?: typeof YTDlpWrapModule }).default ?? YTDlpWrapModule
);

/** Look for a system-installed yt-dlp in common locations (Windows-focused). */
function findSystemYtDlp(): string | null {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const candidates: string[] = [];
  const roots = [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean) as string[];
  for (const root of roots) {
    // pip --user installs: <root>\Python\Python3XX\Scripts\yt-dlp.exe
    for (const base of [join(root, 'Python'), join(root, 'Programs', 'Python')]) {
      try {
        for (const d of readdirSync(base)) candidates.push(join(base, d, 'Scripts', name));
      } catch { /* dir absent */ }
    }
  }
  // Common standalone locations.
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', name));
  candidates.push(join('C:\\', 'ProgramData', 'chocolatey', 'bin', name));
  return candidates.find((c) => existsSync(c)) ?? null;
}
import type {
  DownloadRequest,
  DownloadResult,
  DownloadSource,
  JobProgress,
  PostProcessOptions,
  VideoInfo,
} from '../shared/ipc.js';

// yt-dlp handles both YouTube and Instagram; we just classify for UX/labelling.
function classify(url: string): DownloadSource {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  return 'auto';
}

/**
 * Build a yt-dlp format selector that caps resolution and always lands on a
 * single muxed video+audio file. Audio codec is matched to the target container
 * so the mux is valid: MP4/MOV need AAC (m4a) — pairing them with Opus (webm
 * audio) makes ffmpeg fail with "Could not find tag for codec opus". WebM keeps
 * VP9+Opus. There's always a `best` fallback so a video+audio file still lands.
 */
function formatSelector(req: DownloadRequest): string {
  if (req.audioOnly) return 'bestaudio[ext=m4a]/bestaudio';
  const container = (req.format ?? 'mp4').toLowerCase();

  // Shorts are vertical, so a height<= cap (written for landscape video) would
  // wrongly exclude their native resolution and yield a tiny/odd-looking file.
  // For a Shorts URL we drop the cap and just take the best muxable streams.
  const isShorts = /\/shorts\//i.test(req.url);
  const hf = isShorts ? '' : `[height<=${req.maxHeight ?? 1080}]`;

  if (container === 'webm') {
    return [
      `bestvideo${hf}[ext=webm]+bestaudio[ext=webm]`,
      `bestvideo${hf}+bestaudio`,
      `best${hf}`,
      'best',
    ].join('/');
  }

  // MP4/MOV/MKV and friends: prefer AAC (m4a) audio so it muxes cleanly.
  return [
    `bestvideo${hf}[ext=mp4]+bestaudio[ext=m4a]`,
    `bestvideo${hf}+bestaudio[ext=m4a]`,
    `best${hf}[ext=mp4]`,
    `bestvideo${hf}+bestaudio`,
    `best${hf}`,
    'best',
  ].join('/');
}

// Media containers we may produce — used to ignore subtitle (.srt/.vtt)
// "Destination" lines when detecting the output file, and to locate the
// finished file on disk as a fallback.
const MEDIA_EXT = /\.(mp4|mkv|webm|mov|avi|m4v|flv|mp3|m4a|aac|opus|ogg|oga|wav|flac|wma)$/i;

/** Newest media file in `dir` written since `sinceMs` (optionally matching a stem). */
function newestMediaFile(dir: string, sinceMs: number, stem?: string): string | null {
  try {
    let best: { path: string; mtime: number } | null = null;
    for (const f of readdirSync(dir)) {
      if (!MEDIA_EXT.test(f)) continue;
      if (stem && !f.toLowerCase().includes(stem.toLowerCase())) continue;
      const p = join(dir, f);
      try {
        const st = statSync(p);
        if (st.mtimeMs >= sinceMs - 2000 && (!best || st.mtimeMs > best.mtime)) {
          best = { path: p, mtime: st.mtimeMs };
        }
      } catch { /* skip unreadable entry */ }
    }
    return best?.path ?? null;
  } catch {
    return null;
  }
}

type YtDlp = InstanceType<typeof YTDlpWrap>;
let ytDlp: YtDlp | null = null;

/**
 * Lazily resolve a yt-dlp binary. Order of preference:
 *   1. A binary we've already downloaded into the app's data folder.
 *   2. A freshly downloaded one from GitHub.
 *   3. A system-installed `yt-dlp` on PATH (fallback when offline/blocked).
 * Without this fallback, a failed download left us pointing at a missing
 * binary, so every "Analyze"/download failed.
 */
async function getYtDlp(binDir: string): Promise<YtDlp> {
  if (ytDlp) return ytDlp;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binPath = join(binDir, `yt-dlp${ext}`);

  if (existsSync(binPath)) {
    ytDlp = new YTDlpWrap(binPath);
    return ytDlp;
  }

  // Prefer a system install if present (fast, no network needed).
  const system = findSystemYtDlp();
  if (system) {
    ytDlp = new YTDlpWrap(system);
    return ytDlp;
  }

  try {
    await mkdir(binDir, { recursive: true });
    await YTDlpWrap.downloadFromGithub(binPath);
  } catch {
    // Download failed (offline/blocked) — fall back to PATH below.
  }

  // Use the freshly downloaded binary if it actually landed, else a PATH install.
  ytDlp = existsSync(binPath) ? new YTDlpWrap(binPath) : new YTDlpWrap('yt-dlp');
  return ytDlp;
}

function secondsToLabel(total: number): string {
  if (!total || total < 0) return '0:00';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Fetch lightweight metadata for the "Analyze" step (no download). */
export async function getInfo(url: string, binDir: string): Promise<VideoInfo> {
  const dlp = await getYtDlp(binDir);
  const raw = await dlp.execPromise([url, '--dump-single-json', '--no-playlist']);
  const j = JSON.parse(raw);
  const duration = Number(j.duration ?? 0);
  // Pick a reasonable thumbnail (last is usually highest-res).
  let thumb = j.thumbnail ?? '';
  if (Array.isArray(j.thumbnails) && j.thumbnails.length) {
    thumb = j.thumbnails[j.thumbnails.length - 1]?.url ?? thumb;
  }
  return {
    title: j.title ?? 'Untitled',
    channel: j.uploader ?? j.channel ?? 'Unknown',
    durationSeconds: duration,
    durationLabel: secondsToLabel(duration),
    viewCount: Number(j.view_count ?? 0),
    likeCount: Number(j.like_count ?? 0),
    thumbnail: thumb,
    source: classify(url),
  };
}

/** True if any post-process option needs a follow-up ffmpeg pass. */
function needsFfmpegPass(pp?: PostProcessOptions): boolean {
  return !!pp && (!!pp.normalizeAudio || !!pp.trimSilence || !!pp.removeMetadata);
}

/**
 * Run a single ffmpeg pass over a finished download to apply the audio/metadata
 * post-processing toggles, then atomically replace the original file. Subtitle
 * embedding and chapter splitting are handled by yt-dlp itself, so they're not
 * touched here. Failures are swallowed — the un-processed download still stands.
 */
async function applyFfmpegPostProcess(
  file: string,
  audioOnly: boolean,
  pp: PostProcessOptions,
  jobId: string,
  onProgress: (p: JobProgress) => void,
): Promise<void> {
  if (!ffmpegPath || !file || !existsSync(file)) return;

  const af: string[] = [];
  // EBU R128 loudness normalisation — the YouTube-ish broadcast target.
  if (pp.normalizeAudio) af.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  // Strip leading/trailing and inter-clip silence below ~-50 dB.
  if (pp.trimSilence) {
    af.push(
      'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB:' +
        'stop_periods=-1:stop_duration=0.3:stop_threshold=-50dB',
    );
  }

  const ext = extname(file);
  const tmp = join(dirname(file), `${basename(file, ext)}.pp${ext}`);
  const args = ['-y', '-i', file];

  if (audioOnly) {
    // Audio file: let ffmpeg keep the container's codec; just apply the filters.
    if (af.length) args.push('-af', af.join(','));
  } else if (af.length) {
    // Video file: copy the video stream untouched, re-encode the filtered audio.
    args.push('-c:v', 'copy', '-af', af.join(','), '-c:a', 'aac', '-b:a', '320k');
  } else {
    // Metadata-only change — stream-copy everything for a fast, lossless pass.
    args.push('-c', 'copy');
  }
  if (pp.removeMetadata) args.push('-map_metadata', '-1', '-map_chapters', '-1');
  args.push(tmp);

  onProgress({ jobId, percent: -1, stage: 'processing' });

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args);
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg post-process exited ${code}: ${stderr.slice(-300)}`));
    });
  });

  // Swap the processed file in for the original.
  await unlink(file).catch(() => {});
  await rename(tmp, file);
}

export async function download(
  jobId: string,
  req: DownloadRequest,
  binDir: string,
  onProgress: (p: JobProgress) => void,
): Promise<DownloadResult> {
  const source = classify(req.url);
  const dlp = await getYtDlp(binDir);
  const pp = req.postProcess ?? {};

  const mergeFormat = req.audioOnly ? (req.format || 'mp3') : (req.format || 'mp4');
  // Honour a user-typed filename (from "Browse"), else fall back to the title.
  const stem = req.outputName
    ? req.outputName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '').trim()
    : '';
  const outTemplate = join(req.outputDir, stem ? `${stem}.%(ext)s` : '%(title).200B.%(ext)s');
  const args = [
    req.url,
    '-f', formatSelector(req),
    '--no-playlist',
    ...(req.audioOnly
      ? ['--extract-audio', '--audio-format', mergeFormat]
      : ['--merge-output-format', mergeFormat]),
    // Embed subtitles (downloaded + auto-generated) as a selectable track.
    ...(pp.embedSubs && !req.audioOnly
      ? ['--embed-subs', '--write-subs', '--write-auto-subs', '--sub-langs', 'en.*,en', '--convert-subs', 'srt']
      : []),
    // Split into one file per chapter (yt-dlp keeps the full file too).
    ...(pp.splitByChapter
      ? ['--split-chapters', '-o', `chapter:${join(req.outputDir, '%(title).180B - %(section_number)03d %(section_title)s.%(ext)s')}`]
      : []),
    ...(req.limitRate ? ['--limit-rate', req.limitRate] : []),
    '-o', outTemplate,
  ];

  let title = 'download';
  let outputPath = '';
  const startMs = Date.now();

  await new Promise<void>((resolve, reject) => {
    const ev = dlp.exec(args);
    ev.on('progress', (p: { percent?: number }) => {
      onProgress({ jobId, percent: (p.percent ?? 0) / 100, stage: 'downloading' });
    });
    ev.on('ytDlpEvent', (_t: string, data: string) => {
      // Prefer the merged-output line (the final muxed video) over individual
      // stream destinations. Only accept real media files — with subtitles on,
      // yt-dlp also prints "Destination: video.en.srt", which must NOT become the
      // output path (else "Open location" reveals the .srt and size/title break).
      const m =
        data.match(/Merging formats into "(.+)"/) ||
        data.match(/\[ExtractAudio\] Destination:\s*(.+)/) ||
        data.match(/Destination:\s*(.+)/);
      if (m && MEDIA_EXT.test(m[1].trim())) outputPath = m[1].trim();
      const already = data.match(/\[download\] (.+) has already been downloaded/);
      if (already && MEDIA_EXT.test(already[1].trim())) outputPath = already[1].trim();
    });
    ev.on('error', reject);
    ev.on('close', () => resolve());
  });

  // Belt-and-braces: if no usable path was parsed (or it vanished after a fixup),
  // locate the actual finished media file on disk so "Open location" always lands
  // on it. Prefer a custom-named stem ("Browse" save-as) when one was given.
  if (!outputPath || !existsSync(outputPath)) {
    const found = newestMediaFile(req.outputDir, startMs, stem || undefined);
    if (found) outputPath = found;
  }

  // Apply the audio/metadata ffmpeg pass to the finished file, if requested.
  if (outputPath && needsFfmpegPass(pp)) {
    try {
      await applyFfmpegPostProcess(outputPath, !!req.audioOnly, pp, jobId, onProgress);
    } catch (err) {
      // Keep the un-processed download rather than failing the whole job.
      console.error('post-process failed', err);
    }
  }

  if (outputPath) title = outputPath.split(/[\\/]/).pop() ?? title;
  let bytes = 0;
  try {
    if (outputPath) bytes = (await stat(outputPath)).size;
  } catch {
    // Output path could not be stat'd; leave size at 0.
  }
  onProgress({ jobId, percent: 1, stage: 'done' });
  return { outputPath, title, source, bytes };
}
