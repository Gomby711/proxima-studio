// Bridge between the converter UI and the real FFmpeg engine.
//
// The copied FileConverter panel exposes a 1–100 "Quality" slider, but the
// backend `convert()` service (electron/services/converter.ts) speaks in
// discrete buckets: 'low' | 'medium' | 'high' | 'lossless'. When we wire the
// panel's "Convert" button to `window.api.convert(...)`, we need to translate
// the slider value into one of those buckets.

import type { ConvertRequest } from '../../electron/shared/ipc';

export type ConvertQuality = NonNullable<ConvertRequest['quality']>;

/**
 * Map the UI's 1–100 quality slider to a backend quality bucket.
 */
export function sliderToQuality(slider: number): ConvertQuality {
  // TODO(human): choose the thresholds that split 1–100 into the four buckets
  // ('low' | 'medium' | 'high' | 'lossless'). Consider where "lossless" should
  // kick in (only at 100? 98+?) and how wide the "draft/low" band should be.
  void slider;
  return 'high';
}
