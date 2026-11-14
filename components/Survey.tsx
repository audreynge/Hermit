"use client";
import { Accessibility, CalendarDays, Car, ChevronDown, DoorOpen, Expand, Heart, Layers, ListChecks, MapPin, Sparkles, ArrowRight, Stethoscope, TramFront, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { KEYS, load, save } from "@/lib/client/store";
import { REQUIREMENTS, SIZE_OPTIONS, TIMING_OPTIONS, USE_OPTIONS, type Survey as SurveyT } from "@/lib/spec/survey";
import type { City } from "@/lib/types";
import { Stepper } from "./Stepper";

const REQ_ICON = { ada: Accessibility, parking: Car, ground: DoorOpen, flexible: Layers, patient: Heart, transit: TramFront } as const;
const EMPTY: SurveyT = { transaction: "lease", accessibility: false, requirements: [] };

function Select({ id, value, placeholder, options, onChange }: { id: string; value?: string; placeholder: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="select-wrap">
      <select id={id} className={`control${value ? "" : " placeholder"}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" />
    </div>
  );
}

export function Survey() {
  const router = useRouter();
  const [s, setS] = useState<SurveyT>(EMPTY);
  useEffect(() => { const prev = load<SurveyT>(KEYS.survey); if (prev) setS(prev); }, []);
  const set = (patch: Partial<SurveyT>) => setS((x) => ({ ...x, ...patch }));
  const toggleReq = (v: string) => set({ requirements: s.requirements.includes(v) ? s.requirements.filter((r) => r !== v) : [...s.requirements, v] });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save(KEYS.survey, s);
    save(KEYS.pending, { source: "survey" });
    router.push("/search");
  };

  return (
    <form className="card panel" onSubmit={submit} aria-label="Survey">
      <Stepper current={1} />
      <div className="survey-grid">
        <div>
          <label className="field-label" htmlFor="city"><MapPin aria-hidden="true" /> City</label>
          <Select id="city" value={s.city} placeholder="Select a city" options={[{ value: "houston", label: "Houston, TX" }, { value: "los_angeles", label: "Los Angeles, CA" }]} onChange={(v) => set({ city: (v || undefined) as City | undefined })} />
        </div>
        <div>
          <span className="field-label" id="mode-label"><Layers aria-hidden="true" /> Mode</span>
          <div className="segmented" role="radiogroup" aria-labelledby="mode-label">
            {(["lease", "buy"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={s.transaction === m} onClick={() => set({ transaction: m })}>{m === "lease" ? "Lease" : "Buy"}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="use"><Stethoscope aria-hidden="true" /> Use Type</label>
          <Select id="use" value={s.useType} placeholder="Select use type" options={USE_OPTIONS} onChange={(v) => set({ useType: v || undefined })} />
        </div>
        <div>
          <label className="field-label" htmlFor="size"><Expand aria-hidden="true" /> Size</label>
          <Select id="size" value={s.size} placeholder="Select size range" options={SIZE_OPTIONS} onChange={(v) => set({ size: v || undefined })} />
        </div>
        <div>
          <label className="field-label" htmlFor="budget"><Wallet aria-hidden="true" /> Budget</label>
          <input id="budget" className="control" placeholder="e.g., $5,000 / month or $1,000,000" value={s.budget ?? ""} onChange={(e) => set({ budget: e.target.value })} />
        </div>
        <div>
          <span className="field-label" id="access-label"><Accessibility aria-hidden="true" /> Accessibility Needs</span>
          <button type="button" className="toggle-row" role="switch" aria-checked={s.accessibility} aria-labelledby="access-label access-text" onClick={() => set({ accessibility: !s.accessibility })} style={{ width: "100%" }}>
            <span className="switch" aria-hidden="true" />
            <span id="access-text">I need accessibility accommodations</span>
          </button>
        </div>
      </div>

      <div className="req-row">
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label"><ListChecks aria-hidden="true" /> Requirements <span className="opt">(optional)</span></legend>
          <div className="chips">
            {REQUIREMENTS.map((r) => {
              const Icon = REQ_ICON[r.value];
              return (
                <button key={r.value} type="button" className="chip-toggle" aria-pressed={s.requirements.includes(r.value)} onClick={() => toggleReq(r.value)}>
                  <Icon aria-hidden="true" /> {r.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <span className="divider" aria-hidden="true" />
        <div>
          <label className="field-label" htmlFor="timing"><CalendarDays aria-hidden="true" /> Move-in Timing</label>
          <Select id="timing" value={s.moveIn} placeholder="Select timing" options={TIMING_OPTIONS} onChange={(v) => set({ moveIn: v || undefined })} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 34 }}>
        <button className="cta" type="submit"><Sparkles aria-hidden="true" /> Find shells <ArrowRight aria-hidden="true" /></button>
      </div>
    </form>
  );
}
