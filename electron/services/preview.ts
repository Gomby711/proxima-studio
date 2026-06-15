import { spawn } from 'node:child_process';
import { ffmpegPath } from './ffmpeg.js';
import type { MediaInfo } from '../shared/ipc.js';

/**
 * Source preview, HandBrake-style: probe the file for duration/resolution, then
 * extract single frames on demand at any timestamp. Frames are piped straight
 * out of ffmpeg as JPEG and returned as data URLs (no temp files; works with the
 * renderer's `img-src 'self' data:` CSP).
 */

/** Probe a media file by parsing ffmpeg's stderr banner (no ffprobe needed). */
export function probe(path: string): Promise<MediaInfo> {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve({ durationSeconds: 0, width: 0, height: 0 });
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', path]);
    let err = '';
    proc.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    proc.on('error', () => resolve({ durationSeconds: 0, width: 0, height: 0 }));
    proc.on('close', () => {
      let durationSeconds = 0;
      const d = err.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (d) durationSeconds = Number(d[1]) * 3600 + Number(d[2]) * 60 + parseFloat(d[3]);
      let width = 0;
      let height = 0;
      // First "<w>x<h>" after a video stream line is the coded resolution.
      const s = err.match(/Video:.*?[,\s](\d{2,5})x(\d{2,5})/s);
      if (s) { width = Number(s[1]); height = Number(s[2]); }
      resolve({ durationSeconds, width, height });
    });
  });
}

/** Extract one frame at `atSeconds` (0 for images) as a JPEG data URL. */
export function frame(path: string, atSeconds: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary not found'));
    const seek = atSeconds > 0 ? ['-ss', String(atSeconds)] : [];
    const args = [
      '-hide_banner',
      ...seek,
      '-i', path,
      '-frames:v', '1',
      '-vf', 'scale=720:-2:flags=fast_bilinear',
      '-q:v', '4',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1',
    ];
    const proc = spawn(ffmpegPath, args);
    const chunks: Buffer[] = [];
    let err = '';
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && chunks.length) {
        resolve('data:image/jpeg;base64,' + Buffer.concat(chunks).toString('base64'));
      } else {
        reject(new Error(`preview frame failed: ${err.slice(-200)}`));
      }
    });
  });
}
