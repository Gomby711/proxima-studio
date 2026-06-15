import { spawn, type ChildProcess } from 'node:child_process';
import { basename, dirname, extname, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ffmpegPath } from './ffmpeg.js';
import type { ConvertRequest, ConvertResult, JobProgress } from '../shared/ipc.js';

/**
 * HandBrake-style filename collision handling: if the target already exists
 * (or would overwrite the source), append " (1)", " (2)", … until it's free.
 * When `overwrite` is true we still avoid clobbering the input file itself.
 */
function resolveOutputPath(desired: string, inputPath: string, overwrite: boolean): string {
  const dir = dirname(desired);
  const ext = extname(desired);
  const stem = basename(desired, ext);
  const sameAsInput = (p: string) => p.toLowerCase() === inputPath.toLowerCase();

  if (!sameAsInput(desired) && (overwrite || !existsSync(desired))) return desired;

  let n = 1;
  let candidate = join(dir, `${stem} (${n})${ext}`);
  while (existsSync(candidate) || sameAsInput(candidate)) {
    n += 1;
    candidate = join(dir, `${stem} (${n})${ext}`);
  }
  return candidate;
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'avif']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'aif']);

/** Live ffmpeg processes keyed by jobId, so the UI can cancel them. */
const running = new Map<string, ChildProcess>();

/**
 * Audio output args. Works for both audio→audio and video→audio conversions —
 * `-vn` drops any video stream so e.g. an MP4 becomes a clean MP3. The codec is
 * matched to the target container; lossy formats take a quality-mapped bitrate.
 */
function audioArgs(format: string, quality: ConvertRequest['quality']): string[] {
  const f = format.toLowerCase();
  const bitrate = { low: '128k', medium: '192k', high: '256k', lossless: '320k' }[quality ?? 'medium'];
  const base = ['-vn'];
  switch (f) {
    case 'mp3':  return [...base, '-c:a', 'libmp3lame', '-b:a', bitrate];
    case 'wav':  return [...base, '-c:a', 'pcm_s16le'];
    case 'flac': return [...base, '-c:a', 'flac'];
    case 'aac':
    case 'm4a':  return [...base, '-c:a', 'aac', '-b:a', bitrate];
    case 'ogg':  return [...base, '-c:a', 'libvorbis', '-b:a', bitrate];
    case 'opus': return [...base, '-c:a', 'libopus', '-b:a', bitrate];
    default:     return [...base, '-b:a', bitrate];
  }
}

/** Map a UI quality preset to ffmpeg args for the given target format. */
function qualityArgs(format: string, quality: ConvertRequest['quality'], req?: ConvertRequest): string[] {
  const f = format.toLowerCase();
  if (AUDIO_EXT.has(f)) return audioArgs(f, quality);
  if (IMAGE_EXT.has(f)) {
    // For images, CRF-style quality maps to the codec's quantizer.
    switch (quality) {
      case 'low':
        return ['-q:v', '12'];
      case 'lossless':
        return ['-q:v', '1'];
      case 'high':
        return ['-q:v', '2'];
      default:
        return ['-q:v', '5'];
    }
  }
  // Video: pick an encoder that's valid for the target container so exotic
  // formats don't fail. Lower CRF = higher quality.
  const crf = { low: '30', medium: '23', high: '18', lossless: '0' }[quality ?? 'medium'];
  const fps = req?.fps ? ['-r', req.fps] : [];

  // Container compatibility takes precedence over the requested codec so we
  // never emit an invalid codec/container combination.
  if (f === 'webm') return ['-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-c:a', 'libopus', ...fps];
  if (f === 'avi') return ['-c:v', 'mpeg4', '-qscale:v', '4', '-c:a', 'mp3', ...fps];
  if (f === 'gif') return [...fps]; // ffmpeg derives a palette automatically

  // Honour the UI codec choice where the container allows it.
  const wantsHevc = req?.vcodec === 'H.265' || f === 'hevc';
  const wantsVp9 = req?.vcodec === 'VP9';
  if (wantsVp9) return ['-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-c:a', 'aac', ...fps];
  if (wantsHevc) return ['-c:v', 'libx265', '-crf', crf, '-preset', 'medium', '-c:a', 'aac', ...fps];
  if (['mp4', 'mov', 'mkv', 'm4v', 'flv'].includes(f))
    return ['-c:v', 'libx264', '-crf', crf, '-preset', 'medium', '-c:a', 'aac', ...fps];
  // Exotic containers (prores/dnxhd/mxf/wmv): let ffmpeg choose the container's
  // default encoder rather than forcing an incompatible one.
  return ['-c:a', 'aac', ...fps];
}

/** Parse "HH:MM:SS.ss" (ffmpeg timestamp) into seconds. */
function hmsToSeconds(hms: string): number {
  const [h, m, s] = hms.split(':');
  return Number(h) * 3600 + Number(m) * 60 + parseFloat(s);
}

export function cancelConvert(jobId: string): void {
  const proc = running.get(jobId);
  if (proc) {
    proc.kill('SIGKILL');
    running.delete(jobId);
  }
}

export async function convert(
  jobId: string,
  req: ConvertRequest,
  onProgress: (p: JobProgress) => void,
): Promise<ConvertResult> {
  if (!ffmpegPath) throw new Error('ffmpeg binary not found');

  const start = Date.now();
  // An explicit "Save As" path wins; otherwise auto-name inside the output dir.
  const dir = req.outputDir ?? join(req.inputPath, '..');
  const stem = basename(req.inputPath, extname(req.inputPath));
  const desiredPath = req.outputPath ?? join(dir, `${stem}.${req.targetFormat}`);
  // Never silently overwrite the source or an existing file unless asked to.
  const outputPath = resolveOutputPath(desiredPath, req.inputPath, req.overwrite !== false);

  const args = [
    req.overwrite === false ? '-n' : '-y',
    '-i', req.inputPath,
    ...(req.threads && req.threads > 0 ? ['-threads', String(req.threads)] : []),
    ...qualityArgs(req.targetFormat, req.quality, req),
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args);
    running.set(jobId, proc);
    let stderr = '';
    let totalSec = 0;

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;

      // Total duration appears once near the start.
      if (!totalSec) {
        const d = text.match(/Duration:\s*(\d+:\d+:\d+\.\d+)/);
        if (d) totalSec = hmsToSeconds(d[1]);
      }
      // Encode position streams as "time=HH:MM:SS.ss".
      const t = text.match(/time=\s*(\d+:\d+:\d+\.\d+)/);
      if (t && totalSec > 0) {
        const pct = Math.min(0.99, hmsToSeconds(t[1]) / totalSec);
        onProgress({ jobId, percent: pct, stage: 'converting' });
      } else {
        onProgress({ jobId, percent: -1, stage: 'converting' });
      }
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      running.delete(jobId);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });

  const { size } = await stat(outputPath);
  onProgress({ jobId, percent: 1, stage: 'done' });
  return { outputPath, bytes: size, durationMs: Date.now() - start };
}
