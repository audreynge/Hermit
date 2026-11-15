"use client";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { landlordQuestions } from "@/lib/packet";
import type { ShellReport } from "@/lib/types";
import { usePersisted } from "./shared";

// Landlord questions for one space. `picked` null = everything ticked (so new unknowns arrive ticked).
export function useQuestions(report: Pick<ShellReport, "shellId" | "unknowns" | "buildout">, concerns: string[] = []) {
  const [extra, setExtra] = usePersisted<string[]>(`hermit:extraq:${report.shellId}`, []);
  const [stored, setPicked] = usePersisted<string[] | null>(`hermit:picked:${report.shellId}`, null);
  // Concerns come from the live run only; keep them so the print page (no run context) still lists them.
  const [savedConcerns, setConcerns] = usePersisted<string[]>(`hermit:concerns:${report.shellId}`, []);
  const key = concerns.join("\n");
  useEffect(() => { if (key && key !== savedConcerns.join("\n")) setConcerns(concerns); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const cs = concerns.length ? concerns : savedConcerns;
  const all = useMemo(() => [...new Set([...landlordQuestions(report, cs), ...extra])], [report, cs, extra]);
  const picked = stored ?? all;
  return {
    all, picked,
    toggle: (q: string, on: boolean) => setPicked(on ? [...picked, q] : picked.filter((x) => x !== q)),
    add: (q: string) => { setExtra([...extra, q]); setPicked([...picked, q]); },
    freeze: () => setPicked(all.filter((q) => picked.includes(q))),
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
        <label htmlFor="mine-q" className="sr-only">Add a question</label>
        <input id="mine-q" value={mine} onChange={(e) => setMine(e.target.value)} placeholder="Add a question" />
        <button type="submit" className="btn small"><Plus aria-hidden="true" /> Add</button>
      </form>
    </>
  );
}
