"use client";
import { ArrowRight, Check, Copy, Download, Mail, Pencil, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveThread } from "@/lib/client/persist";
import { ASK, askList, brokerMessage, inferProfile, nextAsk, parseAnswer, type AskField, type Profile } from "@/lib/packet";
import { PacketDoc, useProfile } from "./Packet";
import { QuestionList, useQuestions } from "./Questions";
import { usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

type Ask = { field: AskField; text: string; hint: string };
type Msg = { from: "hermit" | "me"; text: string };
const STEPS = ["Your details", "Review packet", "Questions", "Send"];
const toAsk = (a: (typeof ASK)[number] | null): Ask | null => (a ? { field: a.field, text: a.q, hint: a.hint } : null);

// Questions, the auto-filled tenant packet and the message to the property manager, as one guided flow.
export function Broker({ report, spec, runId, challenge }: ReportCtx) {
  const [flow, setFlow, flowLoaded] = usePersisted<{ step: number; sent: boolean; max?: number }>(`hermit:broker:${report.shellId}`, { step: 1, sent: false });
  const [p, setP, loaded] = useProfile(spec);
  const concerns = useMemo(() => (challenge?.shellId === report.shellId ? challenge.concerns : []), [challenge, report.shellId]);
  const q = useQuestions(report, concerns);
  const [edit, setEdit] = useState<AskField | null>(null);
  const step = flow.step;
  const reached = Math.max(step, flow.max ?? 1);
  const goStep = (n: number) => { setFlow({ ...flow, step: n, max: Math.max(reached, n) }); window.scrollTo({ top: 0 }); };
  const who = report.listing?.kind === "sale" ? "listing agent" : "property manager";

  return (
    <div className="broker">
      <ol className="broker-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? "step" : undefined} data-done={step > i + 1 || undefined}>
            <button type="button" disabled={i + 1 > reached}onClick={() => goStep(i + 1)}>
              <span className="broker-num" aria-hidden="true">{step > i + 1 ? <Check /> : i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && loaded && flowLoaded && (
        <DetailsChat key={edit ?? "start"} p={p} setP={setP} spec={spec} report={report} edit={edit} onDone={() => { setEdit(null); goStep(2); }} />
      )}

      {step === 2 && (
        <section className="broker-step" aria-labelledby="b2">
          <h2 id="b2">Here&apos;s your packet. Does it look right?</h2>
          <p className="muted">Hermit filled this in from your search and your answers. It goes to the {who} with your message.</p>
          <PacketDoc report={report} spec={spec} runId={runId} profile={p} />
          <div className="actions">
            <button type="button" className="btn primary big" onClick={() => goStep(3)}><Check aria-hidden="true" /> Confirm, it looks good to me</button>
            <a className="btn" href={`/packet/${runId}/${report.shellId}?print=1`} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> Download PDF</a>
            <label className="broker-edit"><Pencil aria-hidden="true" className="inline-icon" /> <span className="sr-only">Change a detail</span>
              <select value="" onChange={(e) => { setEdit(e.target.value as AskField); goStep(1); }}>
                <option value="">Change something…</option>
                {askList(spec).map((a) => <option key={a.field} value={a.field}>{a.label}</option>)}
              </select>
            </label>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="broker-step" aria-labelledby="b3">
          <h2 id="b3">Questions to ask</h2>
          <p className="muted">Hermit couldn&apos;t confirm these from the scan or public records, so only the {who} can answer them. Untick any you don&apos;t care about.</p>
          <QuestionList q={q} />
          <div className="actions"><button type="button" className="btn primary big" onClick={() => { q.freeze(); goStep(4); }}>Next: your message <ArrowRight aria-hidden="true" /></button></div>
        </section>
      )}

      {step === 4 && (
        <SendStep report={report} runId={runId} p={p} questions={q.picked} who={who} sent={flow.sent} onSent={() => setFlow({ ...flow, sent: true })} />
      )}
    </div>
  );
}

function DetailsChat({ p, setP, spec, report, edit, onDone }: { p: Profile; setP: (p: Profile) => void; spec: ReportCtx["spec"]; report: ReportCtx["report"]; edit: AskField | null; onDone: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const prof = useRef(p);
  const inputRef = useRef<HTMLInputElement>(null);
  const specLite = { useType: spec.useType, transaction: spec.transaction, mode: spec.mode, rawText: spec.rawText };
  const save = (x: Profile) => { prof.current = x; setP(x); };
  const say = (m: Msg[]) => setMsgs((cur) => [...cur, ...m]);
  const show = (a: Ask | null, extra: Msg[] = []) => {
    setAsk(a); setDone(!a);
    say([...extra, { from: "hermit", text: a ? a.text : "That's everything I need. Take a look at your packet." }]);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  async function turn(body: { field?: AskField; answer?: string; seed?: boolean }, skip = skipped) {
    setBusy(true);
    try {
      const r = await fetch("/api/broker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "next", profile: prof.current, spec: specLite, report: { name: report.name, address: report.address }, skipped: skip, ...body }) });
      if (!r.ok) throw new Error(String(r.status));
      const j: { question: Ask | null; profile: Profile; note?: string } = await r.json();
      save(j.profile);
      if (j.note) say([{ from: "hermit", text: j.note }]);
      else show(j.question);
    } catch {
      // Offline: parse the answer here with the same rules the server falls back to.
      const got = body.field && body.answer ? parseAnswer(body.field, body.answer) : null;
      if (body.field && body.answer && !got) { say([{ from: "hermit", text: "Sorry, I didn't catch that. Try again, or skip it." }]); return; }
      const next = { ...prof.current, ...got };
      save(next);
      show(toAsk(nextAsk(next, spec, skip)));
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const start = inferProfile(prof.current, spec);
    save(start);
    if (edit) { show(toAsk(ASK.find((a) => a.field === edit)!), [{ from: "hermit", text: "Sure, let's change that." }]); return; }
    const known = askList(spec).filter((a) => { const v = start[a.field]; return typeof v === "number" ? v > 0 : !!v; }).map((a) => a.label.toLowerCase());
    say([{ from: "hermit", text: `I'll fill in your tenant packet for ${report.name} so you don't have to.${known.length ? ` I already have your ${known.join(", ")}.` : ""} Just a few quick questions; skip any you'd rather not answer.` }]);
    void turn({ seed: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !ask || busy) return;
    say([{ from: "me", text: t }]); setText("");
    void turn({ field: ask.field, answer: t });
  };
  const skip = () => {
    if (!ask) return;
    const s = [...skipped, ask.field];
    setSkipped(s);
    say([{ from: "me", text: "Skip" }]);
    show(toAsk(nextAsk(prof.current, spec, s)));
  };

  return (
    <section className="broker-step" aria-labelledby="b1">
      <h2 id="b1">A few details for your packet</h2>
      <ul className="broker-chat" aria-live="polite">
        {msgs.map((m, i) => <li key={i} data-from={m.from}>{m.text}</li>)}
        {busy && <li data-from="hermit" className="muted">…</li>}
      </ul>
      {ask && !done && (
        <form className="add-q" onSubmit={submit}>
          <label htmlFor="b-answer" className="sr-only">{ask.text}</label>
          <input id="b-answer" ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={ask.hint} disabled={busy} autoComplete="off" />
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}><Send aria-hidden="true" /> Answer</button>
          <button type="button" className="link-btn" onClick={skip} disabled={busy}>Skip</button>
        </form>
      )}
      <div className="actions">
        {done ? <button type="button" className="btn primary big" onClick={onDone}>Review your packet <ArrowRight aria-hidden="true" /></button>
          : <button type="button" className="link-btn" onClick={onDone}>Skip the rest and review my packet →</button>}
      </div>
    </section>
  );
}

function SendStep({ report, runId, p, questions, who, sent, onSent }: { report: ReportCtx["report"]; runId: string; p: Profile; questions: string[]; who: string; sent: boolean; onSent: () => void }) {
  const to = report.listing?.contact?.email ?? "";
  const subject = `${p.business ? `${p.business}: ` : ""}inquiry about ${report.name}${report.address ? ` (${report.address.split(",")[0]})` : ""}`;
  const [body, setBody] = useState(() => brokerMessage(report, p, questions));
  const [status, setStatus] = useState("");
  const record = () => {
    saveThread({ id: `${runId}:${report.shellId}`, shellId: report.shellId, runId, name: report.name, to, subject, body, status: "sent-by-you", updatedAt: new Date().toISOString() });
    onSent();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(body); setStatus("Copied. Paste it into your email and attach the packet PDF."); record(); }
    catch { setStatus("Copy didn't work here. Select the text and copy it instead."); }
  };
  return (
    <section className="broker-step" aria-labelledby="b4">
      <h2 id="b4">Send it to the {who}</h2>
      <p className="muted">{report.listing?.contact?.name ? `To ${report.listing.contact.name}${report.listing.contact.company ? ` at ${report.listing.contact.company.replace(/\.$/, "")}` : ""}. ` : ""}Edit anything you like. Hermit never sends it for you: your email app opens and you press send.</p>
      <label htmlFor="b-msg" className="sr-only">Message</label>
      <textarea id="b-msg" className="broker-msg" rows={14} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="actions">
        <a className="btn primary big" href={`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} onClick={record}><Mail aria-hidden="true" /> Open in email</a>
        <button type="button" className="btn" onClick={copy}><Copy aria-hidden="true" /> Copy message</button>
        <a className="btn" href={`/packet/${runId}/${report.shellId}?print=1`} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> Packet PDF to attach</a>
        <span role="status" className="muted small">{status}</span>
      </div>
      {sent && (
        <div className="broker-done card pad" role="status">
          <p><Check aria-hidden="true" className="inline-icon" /> <strong>Done.</strong> It&apos;s saved in <Link href="/messages">Messages</Link> too.</p>
          <Link className="btn primary" href="/studio">Look at other matches <ArrowRight aria-hidden="true" /></Link>
        </div>
      )}
    </section>
  );
}
