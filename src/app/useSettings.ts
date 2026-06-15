import { useEffect, useState, useCallback } from "react";
import { DEFAULT_SETTINGS, type AppSettings } from "../../electron/shared/ipc";
import { api } from "../lib/media";

const DENSITY_FONT: Record<string, string> = {
  Compact: "12px",
  Default: "13px",
  Relaxed: "14px",
};

/** Apply settings that change the look/feel of the running window. */
function applyVisual(s: AppSettings) {
  const root = document.documentElement;
  root.style.fontSize = DENSITY_FONT[s.uiDensity] ?? "13px";
  root.dataset.reduceMotion = s.reduceAnimations ? "true" : "false";
}

/**
 * Loads persisted settings, applies the visual ones, and persists every change.
 */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = (await api?.settingsGet()) ?? DEFAULT_SETTINGS;
      if (!alive) return;
      setSettings(s);
      applyVisual(s);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      applyVisual(next);
      return next;
    });
    const saved = await api?.settingsSet(patch);
    if (saved) setSettings(saved);
  }, []);

  return { settings, update, loaded };
}
