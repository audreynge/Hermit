"use client";
import { MessageCircle, Plus, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { KEYS, load } from "@/lib/client/store";
import { roomOf, type Furn } from "@/lib/spec/furnish";
import type { SketchRoom } from "@/lib/spec/sketch";
import { FloorPlan } from "./FloorPlan";
import { usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

type Ask = { role: "user" | "hermit"; text: string; followUp?: string | null };

export function Inside({ report, runId }: ReportCtx) {
  const sid = report.inside?.sid;
  const g = report.floorplan;
  const [room, setRoom] = usePersisted<string | null>(`hermit:tour:${report.shellId}`, report.fit.assignment.find((a) => a.roomId)?.roomId ?? null);
  const [chat, setChat] = usePersisted<Ask[]>(`hermit:ask:${report.shellId}`, []);
  const [extra, setExtra] = usePersisted<string[]>(`hermit:extraq:${report.shellId}`, []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sketchFurn, setSketchFurn] = useState<Record<string, string[]>>({});

  // Furniture the user placed in their own sketch, so Hermit can say "picture your desk here".
  useEffect(() => {
    const p = load<{ layout?: SketchRoom[]; furniture?: Furn[] }>(KEYS.chat);
    const out: Record<string, string[]> = {};
    for (const f of p?.furniture ?? []) { const r = roomOf(f, p?.layout ?? []); if (r) (out[r.label] ??= []).push(f.type); }
    setSketchFurn(out);
  }, []);

  const names = useMemo(() => new Map(report.fit.assignment.filter((a) => a.roomId).map((a) => [a.roomId!, a.req])), [report]);
  const current = g?.rooms.find((r) => r.id === room);
  const req = room ? names.get(room) : undefined;
  const sweep = (current?.panoId && g?.panos?.find((p) => p.id === current.panoId)?.label) || g?.panos?.find((p) => p.id === report.inside?.sweepId)?.label;
  const items = req ? [...new Set(sketchFurn[req.replace(/ #\d+$/, "")] ?? [])] : [];
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const next = [...chat, { role: "user" as const, text: q.trim() }];
    setChat(next); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, shellId: report.shellId, question: q.trim(), room: req ?? current?.label ?? null, history: next.slice(-8).map(({ role, text }) => ({ role, text })) }) });
      const out = await r.json();
      setChat([...next, { role: "hermit", text: out.answer ?? "Sorry, I couldn't answer that.", followUp: out.followUp }]);
    } catch { setChat([...next, { role: "hermit", text: "I couldn't reach the server. Try again?" }]); }
    finally { setBusy(false); }
  };

  return (
    <div className="inside">
      <div className="inside-tour">
        {sid ? (
          <iframe key={sweep ?? "start"} title={`Matterport 3D tour of ${report.name}`} src={`https://my.matterport.com/show/?m=${sid}&play=1&qs=1&brand=0&help=0${sweep && /^\d+$/.test(sweep) ? `&ss=${sweep}` : ""}`} allow="xr-spatial-tracking; fullscreen" allowFullScreen />
        ) : <p className="pad">No 3D scan for this space.</p>}
        <div className="guide inline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hermit-logo.svg" alt="" className="guide-crab" />
          <div className="guide-bubble" aria-live="polite">
            <p>{req
              ? `Your ${req} would go in the room shown in orange on the plan${current ? `, about ${Math.round(current.areaSqft)} sf` : ""}.${items.length ? ` Picture your ${list(items)} there.` : ""} I've moved the tour near it.`
              : current ? `This ${Math.round(current.areaSqft)} sf room isn't assigned to anything you need, so it's spare space.` : "Pick a room on the right and I'll take you near it."}</p>
          </div>
        </div>
      </div>

      <aside className="inside-side" aria-label="Tour guide">
        <h2>Your rooms in this space</h2>
        {g && <FloorPlan graph={g} names={names} highlight={room} onRoom={setRoom} height={220} label={`Floor plan of ${report.name}; your matched room is highlighted`} />}
        <ol className="room-list">
          {report.fit.assignment.map((a) => (
            <li key={a.req}>
              {a.roomId ? <button type="button" aria-pressed={room === a.roomId} onClick={() => setRoom(a.roomId)}>
                <strong>{a.req}</strong> <span className="muted">{Math.round(g?.rooms.find((r) => r.id === a.roomId)?.areaSqft ?? 0)} sf</span>
              </button> : <span className="room-missing"><strong>{a.req}</strong> <span>not built here yet</span></span>}
            </li>
          ))}
        </ol>
        <p className="muted small">Room outlines come from the scan; the tour jumps to the nearest camera spot, which can be a room over.</p>

        <section className="ask" aria-labelledby="ask-title">
          <h3 id="ask-title"><MessageCircle aria-hidden="true" className="inline-icon" /> Ask about this space</h3>
          <div className="ask-log" aria-live="polite">
            {!chat.length && <p className="muted small">Try: “Is there a sink in the exam rooms?” or “Could I fit 4 chairs in reception?”</p>}
            {chat.map((m, i) => (
              <div key={i} className={`ask-msg ${m.role}`}>
                <p>{m.text}</p>
                {m.followUp && !extra.includes(m.followUp) && <button type="button" className="btn small" onClick={() => setExtra([...extra, m.followUp!])}><Plus aria-hidden="true" /> Add “{m.followUp}” to my broker questions</button>}
              </div>
            ))}
            {busy && <p className="muted small">Hermit is checking its notes…</p>}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <label className="sr-only" htmlFor="ask-input">Ask about this space</label>
            <input id="ask-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask anything about this space…" autoComplete="off" />
            <button type="submit" className="send" disabled={!text.trim() || busy} aria-label="Ask"><Send aria-hidden="true" /></button>
          </form>
        </section>
      </aside>
    </div>
  );
}
