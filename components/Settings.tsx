"use client";
import { Settings as Gear, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { applySettings, readSettings, writeSettings, type Settings as S } from "@/lib/client/settings";

function Choice<K extends keyof S>({ label, k, value, options, onChange }: { label: string; k: K; value: S[K]; options: [S[K], string][]; onChange: (k: K, v: S[K]) => void }) {
  return (
    <fieldset className="setting">
      <legend>{label}</legend>
      <div className="seg">
        {options.map(([v, text]) => <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(k, v)}>{text}</button>)}
      </div>
    </fieldset>
  );
}

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<S>(() => ({ theme: "light", text: "normal", motion: "full", tech: false }));
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { const x = readSettings(); setS(x); applySettings(x); }, []);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  const change = <K extends keyof S>(k: K, v: S[K]) => { const next = { ...s, [k]: v }; setS(next); writeSettings(next); };
  return (
    <div className="settings-wrap">
      <button type="button" className="icon-btn" aria-label="Settings" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Gear aria-hidden="true" /></button>
      {open && (
        <div ref={panel} className="settings-panel card" role="dialog" aria-label="Settings">
          <header><h2>Settings</h2><button type="button" className="icon-btn" aria-label="Close settings" onClick={() => setOpen(false)}><X aria-hidden="true" /></button></header>
          <Choice label="Theme" k="theme" value={s.theme} options={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]} onChange={change} />
          <Choice label="Text size" k="text" value={s.text} options={[["normal", "Normal"], ["large", "Large"]]} onChange={change} />
          <Choice label="Motion" k="motion" value={s.motion} options={[["full", "Full"], ["reduced", "Reduced"]]} onChange={change} />
          <Choice label="Crew notes" k="tech" value={s.tech} options={[[false, "Friendly"], [true, "Show the technical log"]]} onChange={change} />
          <p className="muted small">Saved in this browser only.</p>
        </div>
      )}
    </div>
  );
}
