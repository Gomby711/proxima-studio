import ffmpegStatic from 'ffmpeg-static';

/**
 * Resolved path to the bundled ffmpeg binary, valid in BOTH dev and packaged
 * builds on every OS (Windows/macOS/Linux).
 *
 * ffmpeg-static returns a path next to its own module. Once the app is packed
 * into `app.asar`, that path isn't executable — but electron-builder's
 * `asarUnpack` places the real binary alongside at `app.asar.unpacked`, so we
 * rewrite the path to point there. In dev the path has no `app.asar` segment,
 * so the rewrite is a no-op and the real node_modules binary is used as-is.
 *
 * Without this, every ffmpeg call (convert, compress, preview frames, download
 * post-processing) silently fails in the installed app while working in dev.
 */
export const ffmpegPath: string | null = ffmpegStatic
  ? (ffmpegStatic as string).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  : null;
