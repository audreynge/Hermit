"use client";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { landlordQuestions } from "@/lib/packet";
import type { ShellReport } from "@/lib/types";
import { usePersisted } from "./shared";

export const MAX_QUESTIONS = 5;
type QReport = Pick<ShellReport, "shellId" | "unknowns" | "buildout"> & Partial<Pick<ShellReport, "checks" | "fit">>;

// Features a scan photo can show, and the words a question uses for them.
const FEATURES: Record<string, RegExp> = { sink: /\bsinks?\b/i, toilet: /\b(toilets?|restrooms?|bathrooms?)\b/i };
// Questions about the same thing, worded differently. One per topic is enough.
const TOPICS: [string, RegExp][] = [
  ["zoning", /zoning|deed restriction/i],
  ["access", /step-free|accessible restroom|wheelchair/i],
  ["parking", /\bpark/i],
  ["cooling", /cooling|hvac|\btons?\b/i],
  ["exclusive", /\bexclusive\b/i],
  ["sink", /\bsinks?\b/i],
];
const topicOf = (q: string) => TOPICS.find(([, re]) => re.test(q))?.[0] ?? q.toLowerCase();
// Plainer wins: fewer asides (; — parentheses), fewer "can you confirm" tails, then shorter.
const clumsiness = (q: string) => (q.match(/[;—()]/g)?.length ?? 0) + (/can you confirm/i.test(q) ? 2 : 0) + q.length / 400;
const base = (req: string) => req.replace(/\s*#\d+$/, "").toLowerCase();

// Drop questions the scan photos already answer ("Do the exam rooms have their own sinks?" after sinks were seen in
// the rooms Hermit picked as exam rooms), keep one question per topic, and keep at most `max`.
export function cleanQuestions(r: Partial<Pick<ShellReport, "checks" | "fit">>, questions: string[], max = MAX_QUESTIONS): string[] {
  const roomReq = new Map((r.fit?.assignment ?? []).filter((a) => a.roomId).map((a) => [a.roomId!, base(a.req)]));
  const seen = (r.checks ?? []).filter((c) => c.result === "seen" && roomReq.has(c.roomId)).map((c) => ({ feature: c.feature.toLowerCase(), room: roomReq.get(c.roomId)! }));
  // A photo shows a fixture is there, never that it's accessible, so those questions stay.
  const answered = (q: string) => !/accessib/i.test(q) && seen.some(({ feature, room }) => FEATURES[feature]?.test(q) && q.toLowerCase().includes(room));
  const best = new Map<string, string>();
  for (const q of questions) {
    if (answered(q)) continue;
    const t = topicOf(q);
    const cur = best.get(t);
    if (!cur || clumsiness(q) < clumsiness(cur)) best.set(t, q);
  }
  // Keep the original order (the run lists the most important first).
  const keep = new Set(best.values());
  return questions.filter((q) => keep.has(q)).slice(0, max);
}

// Landlord questions for one space. `picked` null = everything ticked (so new unknowns arrive ticked).
export function useQuestions(report: QReport, concerns: string[] = []) {
  const [extra, setExtra] = usePersisted<string[]>(`hermit:extraq:${report.shellId}`, []);
  const [stored, setPicked] = usePersisted<string[] | null>(`hermit:picked:${report.shellId}`, null);
  // Concerns come from the live run only; keep them so the print page (no run context) still lists them.
  const [savedConcerns, setConcerns] = usePersisted<string[]>(`hermit:concerns:${report.shellId}`, []);
  const key = concerns.join("\n");
  useEffect(() => { if (key && key !== savedConcerns.join("\n")) setConcerns(concerns); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const cs = concerns.length ? concerns : savedConcerns;
  // Hermit's own questions are cleaned and capped; the ones you add are always kept.
  const all = useMemo(() => [...new Set([...cleanQuestions(report, landlordQuestions(report, cs)), ...extra])], [report, cs, extra]);
  const picked = stored ? all.filter((q) => stored.includes(q)) : all;
  return {
    all, picked,
    toggle: (q: string, on: boolean) => setPicked(on ? [...picked, q] : picked.filter((x) => x !== q)),
    add: (q: string) => { setExtra([...extra, q]); setPicked([...picked, q]); },
    freeze: () => setPicked(picked),
  };
}

export function QuestionList({ q }: { q: ReturnType<typeof useQuestions> }) {
  const [mine, setMine] = useState("");
  return (
    <>
      <ul className="pick-list">
        {q.all.map((x) => (
          <li key={x}><label><input type="checkbox" checked={q.picked.includes(x)} onChange={(e) => q.toggle(x, e.target.checked)} /> {x}</label></li>
        ))}
      </ul>
      <form className="add-q" onSubmit={(e) => { e.preventDefault(); const t = mine.trim(); if (t && !q.all.includes(t)) q.add(t); setMine(""); }}>
        <label htmlFor="mine-q" className="sr-only">Add your own question</label>
        <input id="mine-q" value={mine} onChange={(e) => setMine(e.target.value)} placeholder="Add your own question" />
        <button type="submit" className="btn small"><Plus aria-hidden="true" /> Add</button>
      </form>
    </>
  );
}
