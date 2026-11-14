"use client";
import type { RequirementSpec, RoomReq } from "@/lib/types";

const NEEDS: [keyof RequirementSpec["needs"], string][] = [
  ["wheelchair", "Wheelchair accessible"], ["stepFree", "Step-free entry"], ["groundFloor", "Ground floor"],
  ["kitchen", "Kitchen"], ["heavyPower", "Heavy power"], ["threePhase", "Three-phase power"], ["esfr", "ESFR sprinklers"], ["outdoorArea", "Outdoor area"],
];

export function SpecEditor({ spec, onChange }: { spec: RequirementSpec; onChange: (s: RequirementSpec) => void }) {
  const setRoom = (i: number, patch: Partial<RoomReq>) => onChange({ ...spec, rooms: spec.rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const optNum = (v: string) => (v === "" ? undefined : Number(v));

  return (
    <section className="card stack" aria-labelledby="spec-title">
      <h2 id="spec-title" tabIndex={-1}>Your requirements</h2>
      <p className="muted">Check what Hermit understood. Edit anything before searching.</p>
      <div className="row" aria-label="Summary">
        <span className="chip">{spec.mode}</span>
        <span className="chip">{spec.city === "houston" ? "Houston" : "Los Angeles"}</span>
        <span className="chip">{spec.useType}</span>
        {spec.sizeSqft && <span className="chip num">{spec.sizeSqft[0].toLocaleString()}–{spec.sizeSqft[1].toLocaleString()} sf</span>}
        {spec.beds != null && <span className="chip">{spec.beds} bd</span>}
        {spec.baths != null && <span className="chip">{spec.baths} ba</span>}
        {spec.budgetMonthly && <span className="chip num">${spec.budgetMonthly.toLocaleString()}/mo</span>}
        {spec.budgetTotal && <span className="chip num">${spec.budgetTotal.toLocaleString()}</span>}
        <span className="chip">via {spec.input}</span>
      </div>

      <div className="grid2">
        <label className="field">Use
          <input value={spec.useType} onChange={(e) => onChange({ ...spec, useType: e.target.value || "office" })} />
        </label>
        <label className="field">Min sf
          <input inputMode="numeric" value={spec.sizeSqft?.[0] ?? ""} onChange={(e) => {
            const lo = optNum(e.target.value);
            onChange({ ...spec, sizeSqft: lo ? [lo, Math.max(lo, spec.sizeSqft?.[1] ?? lo * 1.5)] : undefined });
          }} />
        </label>
        <label className="field">Max sf
          <input inputMode="numeric" value={spec.sizeSqft?.[1] ?? ""} onChange={(e) => {
            const hi = optNum(e.target.value);
            onChange({ ...spec, sizeSqft: hi ? [Math.min(spec.sizeSqft?.[0] ?? hi * 0.7, hi), hi] : undefined });
          }} />
        </label>
      </div>

      <fieldset>
        <legend>Rooms</legend>
        {spec.rooms.length === 0 && <p className="muted">No specific rooms. Hermit will match on size and use.</p>}
        <table>
          <thead><tr><th>Room</th><th>Count</th><th>Min sf</th><th>Must have</th><th><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {spec.rooms.map((r, i) => (
              <tr key={i}>
                <td><input aria-label={`Room ${i + 1} name`} value={r.label} onChange={(e) => setRoom(i, { label: e.target.value })} /></td>
                <td><input aria-label={`${r.label} count`} type="number" min={1} max={20} value={r.count} onChange={(e) => setRoom(i, { count: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 72 }} /></td>
                <td><input aria-label={`${r.label} minimum square feet`} inputMode="numeric" value={r.minSqft ?? ""} onChange={(e) => setRoom(i, { minSqft: optNum(e.target.value) })} style={{ width: 90 }} /></td>
                <td><input aria-label={`${r.label} is required`} type="checkbox" checked={r.hard} onChange={(e) => setRoom(i, { hard: e.target.checked })} style={{ width: 22, minHeight: 22 }} /></td>
                <td><button type="button" className="btn ghost small" aria-label={`Remove ${r.label}`} onClick={() => onChange({ ...spec, rooms: spec.rooms.filter((_, j) => j !== i) })}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn ghost small" style={{ marginTop: 8 }} onClick={() => onChange({ ...spec, rooms: [...spec.rooms, { label: "office", count: 1, hard: false }] })}>+ Add room</button>
      </fieldset>

      <fieldset>
        <legend>Must-haves</legend>
        <div className="row">
          {NEEDS.map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={!!spec.needs[k]} onChange={(e) => onChange({ ...spec, needs: { ...spec.needs, [k]: e.target.checked || undefined } })} />
              {label}
            </label>
          ))}
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <label className="field">Parking stalls
            <input inputMode="numeric" value={spec.needs.parkingStalls ?? ""} onChange={(e) => onChange({ ...spec, needs: { ...spec.needs, parkingStalls: optNum(e.target.value) } })} />
          </label>
          <label className="field">Drive-in bays
            <input inputMode="numeric" value={spec.needs.driveInBays ?? ""} onChange={(e) => onChange({ ...spec, needs: { ...spec.needs, driveInBays: optNum(e.target.value) } })} />
          </label>
        </div>
      </fieldset>
    </section>
  );
}
