"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ReportPanel } from "./ReportPanel";
import { Viewer } from "./Viewer";
import { decodeSpec } from "@/lib/spec/url";
import type { ShellReport, TraceEvent } from "@/lib/types";

type Status = "idle" | "running" | "done" | "error";

export function Results() {
  const params = useSearchParams();
  const specParam = params.get("spec");
  const replay = params.get("replay");
  const spec = useMemo(() => (specParam ? decodeSpec(specParam) : null), [specParam]);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [reports, setReports] = useState<ShellReport[]>([]);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!spec && !replay) return;
    const ctrl = new AbortController();
    setEvents([]); setReports([]); setSelected(0); setStatus("running"); setError("");
    (async () => {
      try {
        const res = replay
          ? await fetch(`/api/agent?replay=${encodeURIComponent(replay)}`, { signal: ctrl.signal })
          : await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec), signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(res.status === 404 ? "No recorded run found. Run a live search first." : `Search failed (${res.status})`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const p of parts) {
            const line = p.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const e = JSON.parse(line.slice(6)) as TraceEvent;
            setEvents((x) => [...x, e]);
            if (e.type === "run") setRunId(e.runId);
            if (e.type === "report") setReports(e.reports);
            if (e.type === "done") setStatus("done");
          }
        }
        setStatus((s) => (s === "running" ? "done" : s));
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
    return () => ctrl.abort();
  }, [spec, replay]);

  if (specParam && !spec) return <p role="alert">That search link is invalid. <Link href="/plan">Start again</Link>.</p>;
  if (!spec && !replay) return <p>Nothing to search yet. <Link href="/plan">Plan a search</Link>.</p>;

  const done = events.find((e) => e.type === "done") as Extract<TraceEvent, { type: "done" }> | undefined;
  const drops = events.filter((e) => e.type === "drop").length;
  const current = reports[selected];

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "var(--t-2xl)", marginBottom: 4 }}>{replay ? "Recorded run" : `Spaces for a ${spec!.useType}`}</h1>
          <p className="muted" role="status" aria-live="polite">
            {status === "running" && `Searching… ${events.filter((e) => e.type === "tool").length} steps so far`}
            {status === "done" && `${reports.length} Shell Reports · ${drops} candidates dropped on evidence · ${done ? `${(done.ms / 1000).toFixed(1)} s, ${done.toolCalls} tool calls, ${done.planner} planner` : ""}`}
            {status === "error" && "Search stopped."}
          </p>
        </div>
        <Link className="btn ghost no-print" href="/plan">New search</Link>
      </div>
      {error && <p role="alert" className="status-fail">{error}</p>}
      {status === "done" && reports.length === 0 && (
        <p className="card">No candidate survived the evidence checks. Try widening the size range or relaxing a must-have. The trace below shows why each one was dropped.</p>
      )}

      {reports.length > 0 && (
        <div className="results">
          <nav aria-label="Shortlist" className="stack">
            {reports.map((r, i) => (
              <button key={r.shellId} className="shell-card" aria-pressed={i === selected} onClick={() => setSelected(i)}>
                <span className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">#{r.rank}</span>
                  <span className={`badge ${r.badge === "scan-verified" ? "verified" : "record"}`}>{r.badge}</span>
                </span>
                <strong>{r.name.split(" · ")[0]}</strong>
                <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{r.address}</span>
                <span><span className="score num">{r.badge === "record-only" ? "—" : r.fit.score}</span> <span className="muted">{r.badge === "record-only" ? "not measured" : "fit"} · {r.verdict}</span></span>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--t-sm)" }}>{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
              </button>
            ))}
          </nav>
          {current && <Viewer key={current.shellId} report={current} />}
          {current && <ReportPanel key={`p-${current.shellId}`} report={current} runId={runId} />}
        </div>
      )}

      <section className="card" aria-labelledby="trace-title">
        <details open>
          <summary><h2 id="trace-title" style={{ display: "inline", fontSize: "var(--t-lg)" }}>How Hermit decided</h2></summary>
          <ol className="trace" aria-label="Agent trace" tabIndex={0}>
            {events.filter((e) => e.type !== "report" && e.type !== "run").map((e) => (
              <li key={e.id}>
                <span className={`kind ${e.type}`}>{e.type}</span>{" "}
                {e.type === "plan" && e.text}
                {e.type === "tool" && <><code>{e.tool}</code> {e.summary} <span className="muted num">({e.resultId}, {e.ms} ms)</span></>}
                {e.type === "drop" && <><strong>{e.shellId}</strong>: {e.reason} {e.evidence.length > 0 && <span className="muted">[{e.evidence.map((x) => x.ref).join("; ")}]</span>}</>}
                {e.type === "escalate" && <><strong>{e.shellId}</strong>: {e.question} → {e.outcome}</>}
                {e.type === "rerank" && e.reason}
                {e.type === "error" && <span className="status-fail">{e.message}</span>}
                {e.type === "done" && `Finished in ${(e.ms / 1000).toFixed(1)} s with ${e.toolCalls} tool calls (${e.planner}).`}
              </li>
            ))}
          </ol>
        </details>
      </section>
    </div>
  );
}
