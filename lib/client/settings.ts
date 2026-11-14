"use client";
import { useEffect, useState } from "react";

export type Settings = { theme: "system" | "light" | "dark"; text: "normal" | "large"; motion: "full" | "reduced"; tech: boolean };
export const DEFAULT_SETTINGS: Settings = { theme: "system", text: "normal", motion: "full", tech: false };
const KEY = "hermit:settings";
const EVENT = "hermit-settings";

export function readSettings(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULT_SETTINGS; }
}

export function applySettings(s: Settings) {
  const el = document.documentElement;
  if (s.theme === "system") el.removeAttribute("data-theme"); else el.dataset.theme = s.theme;
  el.dataset.text = s.text;
  el.dataset.motion = s.motion;
}

export function writeSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* per-viewer convenience only */ }
  applySettings(s);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: s }));
}

export function useSettings(): Settings {
  const [s, set] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    set(readSettings());
    const on = (e: Event) => set((e as CustomEvent<Settings>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return s;
}

export const reducedMotion = () =>
  typeof window !== "undefined" && (document.documentElement.dataset.motion === "reduced" || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
