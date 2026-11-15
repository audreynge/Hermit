"use client";
import { useMemo } from "react";
import { emptyProfile, type Profile } from "@/lib/packet";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { FloorPlan } from "./FloorPlan";
import { useQuestions } from "./Questions";
import { toFootprint } from "@/lib/furnish/footprint";
import { useFurnished, useMoney, usePersisted } from "./shared";

const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;

// Saved once per browser and reused for every space; merged over the empty profile so older saves gain new fields.
export function useProfile(spec: Pick<RequirementSpec, "useType">) {
  const [stored, setP, loaded] = usePersisted<Partial<Profile>>("hermit:profile", {});
  const p: Profile = { ...emptyProfile(spec), ...stored };
  return [p, setP as (p: Profile) => void, loaded] as const;
}

// The packet itself, used in the Broker review step and on the printable page.
export function PacketDoc({ report, spec, runId, profile }: { report: ShellReport; spec: RequirementSpec; runId: string; profile?: Profile }) {
  const [stored] = useProfile(spec);
  const p = profile ?? stored;
  const [items] = useFurnished(report.shellId, report.inside?.sid);
  const { picked } = useQuestions(report);
  const [m] = useMoney(spec, report);
  const names = useMemo(() => new Map(report.fit.assignment.filter((a) => a.roomId).map((a) => [a.roomId!, a.req])), [report]);
  const rooms = spec.rooms.map((r) => `${r.count} × ${r.label}${r.minSqft ? ` (at least ${r.minSqft} sq ft)` : ""}${r.fixtures?.length ? `, with ${r.fixtures.join(", ")}` : ""}`);
  const missing = <em className="muted">not listed</em>;
  return (
    <article className="packet-doc" aria-label="Tenant packet">
      <header>
        <p className="eyebrow">Tenant packet · prepared with Hermit</p>
        <h2>{p.business || "Your business"} for {report.name}</h2>
        <p className="muted">{report.address}</p>
      </header>
      <section><h3>Contact</h3>
        <p>{[p.contactName, p.email, p.phone].filter(Boolean).join(" · ") || missing}</p></section>
      <section><h3>The business</h3><p>{p.concept || <em className="muted">Add a one-line description.</em>}</p>
        <p><strong>Proposed use:</strong> “{p.useClause}”</p></section>
      <section><h3>What the space needs</h3><p>{spec.useType} in {spec.city === "houston" ? "Houston" : "Los Angeles"}{spec.sizeSqft ? `, ${spec.sizeSqft[0].toLocaleString()} to ${spec.sizeSqft[1].toLocaleString()} sq ft` : ""}.</p>
        <ul>
          <li>Move-in: {p.moveIn || missing}</li>
          {spec.transaction !== "buy" && <li>Lease length: {p.leaseTerm || missing}</li>}
          {rooms.map((r) => <li key={r}>{r}</li>)}
        </ul></section>
      <section><h3>Money and track record</h3>
        <ul>
          <li>Cash available: {p.cash ? $(p.cash) : missing}</li>
          <li>Reserve: {p.reserveMonths ? `${p.reserveMonths} months of costs${m.rent ? ` (${$(p.reserveMonths * (m.rent + m.utilities + m.other))})` : ""}` : missing}</li>
          <li>Financing: {p.financing || missing}</li>
          <li>Experience: {[p.years && `${p.years} in the trade`, p.trackRecord].filter(Boolean).join(". ") || missing}</li>
          <li>Personal guarantee: {p.guarantee === "yes" ? "willing to provide" : p.guarantee === "capped" ? "willing to provide a capped guarantee" : p.guarantee === "no" ? "prefers none" : <em className="muted">not stated</em>}</li>
        </ul></section>
      <section><h3>How we&apos;ll use the space</h3>
        {report.floorplan && items.length ? <FloorPlan graph={report.floorplan} names={names} items={items.map((p) => toFootprint(p, report.floorplan!.rooms))} height={320} label={`Furnished layout of ${report.name}`} /> : <p className="muted">No furnished layout yet.</p>}</section>
      <section><h3>What&apos;s left to build</h3>
        {report.work.length ? <ul>{report.work.map((w, i) => <li key={i}>{w.item} ({w.weeksLow} to {w.weeksHigh} weeks)</li>)}</ul> : <p>Nothing found in the scan.</p>}</section>
      <section><h3>Questions for the landlord</h3><ol>{picked.map((q) => <li key={q}>{q}</li>)}</ol></section>
      <p className="small muted">Screening summary from public data and the 3D scan, ref {runId}. Not an inspection or a legal review.</p>
    </article>
  );
}
