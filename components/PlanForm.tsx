"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutBuilder } from "./LayoutBuilder";
import { SpecEditor } from "./SpecEditor";
import type { Block } from "@/lib/spec/parse";
import { encodeSpec } from "@/lib/spec/url";
import type { City, Mode, RequirementSpec } from "@/lib/types";

type Express = "text" | "voice" | "layout" | "survey";
const EXAMPLES: Record<Mode, string> = {
  business: "Dental clinic in Houston, 2,000-3,000 sq ft, 3 exam rooms with sinks, a waiting room, 2 restrooms, wheelchair accessible",
  enterprise: "20,000 sf warehouse in Los Angeles with heavy power, ESFR sprinklers and 2 drive-in doors",
  home: "3 bedroom 2 bath house in Houston under $450k with a home office",
};

type SpeechRec = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void };

export function PlanForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("business");
  const [city, setCity] = useState<City>("houston");
  const [useType, setUseType] = useState("");
  const [minSf, setMinSf] = useState("");
  const [maxSf, setMaxSf] = useState("");
  const [headcount, setHeadcount] = useState("");
  const [budget, setBudget] = useState("");
  const [beds, setBeds] = useState("");
  const [baths, setBaths] = useState("");
  const [moveInBy, setMoveInBy] = useState("");
  const [ti, setTi] = useState("");
  const [freeRent, setFreeRent] = useState("");
  const [needs, setNeeds] = useState<RequirementSpec["needs"]>({});
  const [express, setExpress] = useState<Express>("text");
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [listening, setListening] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState("");
  const [spec, setSpec] = useState<RequirementSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const n = (v: string) => (v.trim() ? Number(v.replace(/[,$]/g, "")) : undefined);

  function survey(): Partial<RequirementSpec> {
    const lo = n(minSf), hi = n(maxSf), b = n(budget);
    return {
      mode, city, useType: useType.trim() || undefined,
      sizeSqft: lo && hi ? [lo, hi] : lo ? [lo, lo * 1.5] : undefined,
      headcount: n(headcount), beds: mode === "home" ? n(beds) : undefined, baths: mode === "home" ? n(baths) : undefined,
      ...(b ? (mode === "home" && b > 20000 ? { budgetTotal: b } : { budgetMonthly: b }) : {}),
      moveInBy: moveInBy || undefined, tiPerSqft: n(ti), freeRentMonths: n(freeRent),
      needs: Object.fromEntries(Object.entries(needs).filter(([, v]) => v)),
    };
  }

  async function buildSpec(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/spec", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: express, text, layout: blocks, survey: survey(), defaults: { city, mode } }),
      });
      if (!res.ok) throw new Error((await res.json()).error?.[0]?.message ?? `Spec failed (${res.status})`);
      setSpec(await res.json());
      requestAnimationFrame(() => document.getElementById("spec-title")?.focus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function listen() {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Rec = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Rec) { setVoiceMsg("Voice input isn't supported in this browser. Type your request instead."); return; }
    const r = new Rec();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (ev) => setText((t) => `${t} ${Array.from(ev.results).map((x) => x[0].transcript).join(" ")}`.trim());
    r.onend = () => setListening(false);
    r.onerror = () => { setListening(false); setVoiceMsg("Couldn't hear that. Check microphone permission or type instead."); };
    setListening(true);
    setVoiceMsg("Listening…");
    r.start();
  }

  const toggle = (k: keyof RequirementSpec["needs"]) => setNeeds((x) => ({ ...x, [k]: !x[k] }));

  return (
    <div className="stack">
      <form className="card stack" onSubmit={buildSpec} aria-labelledby="intake-title">
        <h1 id="intake-title" style={{ fontSize: "var(--t-2xl)" }}>What do you need?</h1>

        <fieldset>
          <legend>Search type</legend>
          <div className="row" role="radiogroup" aria-label="Search type">
            {(["business", "enterprise", "home"] as Mode[]).map((m) => (
              <label key={m} className="check">
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                {m === "business" ? "Business suite" : m === "enterprise" ? "Industrial / site" : "Home"}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid2">
          <label className="field">City
            <select value={city} onChange={(e) => setCity(e.target.value as City)}>
              <option value="houston">Houston</option>
              <option value="los_angeles">Los Angeles</option>
            </select>
          </label>
          {mode !== "home" && (
            <label className="field">Intended use
              <input placeholder={mode === "enterprise" ? "warehouse, light manufacturing…" : "dental clinic, salon, office…"} value={useType} onChange={(e) => setUseType(e.target.value)} />
            </label>
          )}
          <label className="field">Min sf<input inputMode="numeric" value={minSf} onChange={(e) => setMinSf(e.target.value)} /></label>
          <label className="field">Max sf<input inputMode="numeric" value={maxSf} onChange={(e) => setMaxSf(e.target.value)} /></label>
          {mode === "home" ? (
            <>
              <label className="field">Bedrooms<input inputMode="numeric" value={beds} onChange={(e) => setBeds(e.target.value)} /></label>
              <label className="field">Bathrooms<input inputMode="decimal" value={baths} onChange={(e) => setBaths(e.target.value)} /></label>
            </>
          ) : (
            <label className="field">Headcount<input inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value)} /></label>
          )}
          <label className="field">{mode === "home" ? "Budget (price or rent/mo)" : "Budget per month"}<input inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <label className="field">Move in by<input type="date" value={moveInBy} onChange={(e) => setMoveInBy(e.target.value)} /></label>
        </div>

        <fieldset>
          <legend>Must-haves</legend>
          <div className="row">
            <label className="check"><input type="checkbox" checked={!!needs.wheelchair} onChange={() => toggle("wheelchair")} />Wheelchair accessible</label>
            <label className="check"><input type="checkbox" checked={!!needs.groundFloor} onChange={() => toggle("groundFloor")} />Ground floor</label>
            {mode !== "home" && <label className="check"><input type="checkbox" checked={!!needs.kitchen} onChange={() => toggle("kitchen")} />Kitchen</label>}
            {mode === "enterprise" && (
              <>
                <label className="check"><input type="checkbox" checked={!!needs.heavyPower} onChange={() => toggle("heavyPower")} />Heavy power</label>
                <label className="check"><input type="checkbox" checked={!!needs.esfr} onChange={() => toggle("esfr")} />ESFR sprinklers</label>
              </>
            )}
          </div>
        </fieldset>

        {mode !== "home" && (
          <details>
            <summary>Optional lease inputs</summary>
            <div className="grid2" style={{ marginTop: 12 }}>
              <label className="field">TI allowance ($/sf)<input inputMode="decimal" value={ti} onChange={(e) => setTi(e.target.value)} /></label>
              <label className="field">Free rent (months)<input inputMode="numeric" value={freeRent} onChange={(e) => setFreeRent(e.target.value)} /></label>
            </div>
          </details>
        )}

        <div>
          <div className="tabs" role="tablist" aria-label="How to describe your space">
            {(["text", "voice", "layout", "survey"] as Express[]).map((x) => (
              <button key={x} type="button" role="tab" id={`tab-${x}`} aria-selected={express === x} aria-controls={`panel-${x}`} onClick={() => setExpress(x)}>
                {x === "text" ? "Describe it" : x === "voice" ? "Say it" : x === "layout" ? "Draw a layout" : "Survey only"}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${express}`} aria-labelledby={`tab-${express}`}>
            {(express === "text" || express === "voice") && (
              <div className="stack">
                <label className="field" htmlFor="need-text">Describe the space in your own words</label>
                <textarea id="need-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLES[mode]} />
                <div className="row">
                  {express === "voice" && <button type="button" className="btn ghost" onClick={listen} disabled={listening}>{listening ? "Listening…" : "Start speaking"}</button>}
                  <button type="button" className="btn ghost small" onClick={() => setText(EXAMPLES[mode])}>Use an example</button>
                  <span role="status" className="muted">{voiceMsg}</span>
                </div>
              </div>
            )}
            {express === "layout" && <LayoutBuilder blocks={blocks} onChange={setBlocks} />}
            {express === "survey" && <p className="muted">Hermit will search using the fields above.</p>}
          </div>
        </div>

        {error && <p role="alert" className="status-fail">{error}</p>}
        <div className="row">
          <button className="btn" type="submit" disabled={busy || (express === "layout" && !blocks.length) || ((express === "text" || express === "voice") && !text.trim())}>
            {busy ? "Reading your request…" : "Build my requirements"}
          </button>
        </div>
      </form>

      {spec && (
        <>
          <SpecEditor spec={spec} onChange={setSpec} />
          <div className="row">
            <button className="btn" type="button" onClick={() => router.push(`/results?spec=${encodeSpec(spec)}`)}>Find spaces</button>
          </div>
        </>
      )}
    </div>
  );
}
