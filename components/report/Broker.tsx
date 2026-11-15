"use client";
import { ArrowRight, Check, Copy, Download, Eye, Mail, Pencil, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveThread } from "@/lib/client/persist";
import { ASK, askList, inferProfile, nextAsk, parseAnswer, type AskField, type Profile } from "@/lib/packet";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { PacketDoc, useProfile } from "./Packet";
import { QuestionList, useQuestions } from "./Questions";
import { usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

type Ask = { field: AskField; text: string; hint: string };
type Msg = { from: "hermit" | "me"; text: string };
const toAsk = (a: (typeof ASK)[number] | null): Ask | null => (a ? { field: a.field, text: a.q, hint: a.hint } : null);

const CITY: Record<string, string> = { houston: "Houston", los_angeles: "Los Angeles" };
const plural = (w: string, n: number) => (n === 1 || w.endsWith("s") ? w : `${w}s`);
const art = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const base = (req: string) => req.replace(/\s*#\d+$/, "").toLowerCase();

type DraftSpec = Partial<Pick<RequirementSpec, "mode" | "city" | "useType" | "rooms" | "needs" | "sizeSqft" | "rawText">>;
type DraftReport = Pick<ShellReport, "name" | "address"> & Partial<Pick<ShellReport, "listing" | "fit" | "checks">>;

// Who the message goes to: the listing contact on record, else "the listing broker".
export function contactOf(r: Partial<Pick<ShellReport, "listing">>) {
  const c = r.listing?.contact;
  return {
    label: c?.name ? `${c.name}${c.company ? `, ${c.company.replace(/\.$/, "")}` : ""}` : "the listing broker",
    email: c?.email ?? "",
    first: c?.name?.trim().split(/\s+/)[0] ?? "",
  };
}

// Where the space is, said the way a person would: "Suite 1202 at 1315 St Joseph Pky".
function placeOf(r: DraftReport) {
  const street = r.address.split(",")[0].trim();
  const name = r.name.split(" · ")[0].trim();
  return !name || street.toLowerCase().startsWith(name.toLowerCase()) ? street : `${name} at ${street}`;
}

// One line of evidence for "why this space": a fixture the scan photos saw in the rooms Hermit picked, else rooms already built.
function whyLine(r: DraftReport, spec: DraftSpec) {
  const assigned = (r.fit?.assignment ?? []).filter((x) => x.roomId);
  for (const room of spec.rooms ?? []) {
    const mine = assigned.filter((x) => base(x.req) === room.label.toLowerCase());
    for (const f of room.fixtures ?? []) {
      const hits = mine.filter((x) => r.checks?.some((c) => c.roomId === x.roomId && c.result === "seen" && c.feature.toLowerCase() === f.toLowerCase()));
      if (!hits.length) continue;
      const n = mine.length;
      const which = n === 1 ? `the room I'd use as ${art(room.label)}`
        : hits.length === n ? `${n === 2 ? "both" : `all ${n}`} rooms I'd use as ${plural(room.label, 2)}`
        : `${hits.length} of the ${n} rooms I'd use as ${plural(room.label, 2)}`;
      return `the 3D scan shows ${hits.length === 1 ? art(f) : plural(f, 2)} already in ${which}`;
    }
  }
  const want = (spec.rooms ?? []).reduce((s, x) => s + x.count, 0);
  const built = assigned.filter((x) => (spec.rooms ?? []).some((s) => s.label.toLowerCase() === base(x.req))).length;
  return want && built ? `the 3D scan shows ${built} of the ${want} rooms I need already built` : "it looks close to what I need";
}

// Who she is: her own first sentence when it introduces her ("I'm a pediatrician..."), else a plain line from the spec.
function introLine(spec: DraftSpec, p: Profile) {
  const me = p.contactName ? `My name is ${p.contactName}${p.business ? ` and I run ${p.business}` : ""}. ` : "";
  const first = spec.rawText?.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  if (/^(i'm|i am|we're|we are|my |our )/i.test(first) && first.length <= 160) return `${me}${/[.!?]$/.test(first) ? first : `${first}.`}`;
  const city = spec.city ? ` in ${CITY[spec.city] ?? spec.city}` : "";
  return `${me}${spec.mode === "home" ? `I'm looking for a place to live${city}.` : `I'm opening ${art(spec.useType || "business")}${city}.`}`;
}

// What she needs: size, rooms (with fixtures) and the access and parking must-haves.
function needsLine(spec: DraftSpec) {
  const rooms = (spec.rooms ?? []).map((r) => {
    const label = r.label === "reception" ? "reception area" : r.label;
    const fx = r.fixtures?.length ? ` (with ${list(r.fixtures.map((f) => (r.count === 1 ? art(f) : plural(f, 2))))})` : "";
    return `${r.count === 1 ? art(label) : `${r.count} ${plural(label, r.count)}`}${fx}`;
  });
  const n = spec.needs ?? {};
  const extras = [n.stepFree && "step-free entry", n.wheelchair && "room for a wheelchair", n.groundFloor && "a ground-floor space", n.parkingStalls && `parking for ${n.parkingStalls} cars`].filter(Boolean) as string[];
  const size = spec.sizeSqft ? `about ${spec.sizeSqft[0].toLocaleString()} to ${spec.sizeSqft[1].toLocaleString()} sq ft` : "";
  const parts = [...rooms, ...extras];
  if (!size && !parts.length) return "";
  return `I need ${size || "a space"}${parts.length ? ` with ${list(parts)}` : ""}.`;
}

// The ready-to-send message, written from the report. Hermit never sends it.
export function brokerDraft(r: DraftReport, spec: DraftSpec, p: Partial<Profile>, questions: string[]) {
  const to = contactOf(r);
  const place = placeOf(r);
  const prof = { business: "", concept: "", contactName: "", email: "", phone: "", cash: 0, ...p } as Profile;
  const subject = `${prof.business ? `${prof.business}: ` : ""}Question about ${place}`;
  const packet = prof.business || prof.concept || prof.cash || prof.contactName ? "I've attached a short tenant packet with my business details." : "I'm happy to send a short tenant packet with my business details.";
  const sign = [prof.contactName, prof.business, prof.email, prof.phone].filter(Boolean).join("\n");
  const body = [
    `Hi${to.first ? ` ${to.first}` : ""},`,
    [introLine(spec, prof), needsLine(spec)].filter(Boolean).join(" "),
    `${place} looks like a good fit: ${whyLine(r, spec)}.`,
    questions.length ? `A few questions before I come see it:\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : "",
    `Is it still available, and could we set up a time for me to see it? ${packet}`,
    sign ? `Thanks,\n${sign}` : "Thanks!",
  ].filter(Boolean).join("\n\n");
  return { to, subject, body };
}

export const mailtoHref = (to: string, subject: string, body: string) => `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const fieldLabel = { alignSelf: "center", minWidth: 72, fontWeight: 700 } as const;

// "Talk to your broker": a ready message first; the tenant packet is an optional extra underneath.
export function Broker({ report, spec, runId, challenge }: ReportCtx) {
  const [flow, setFlow] = usePersisted<{ sent: boolean }>(`hermit:broker:${report.shellId}`, { sent: false });
  const [p, setP, loaded] = useProfile(spec);
  const concerns = useMemo(() => (challenge?.shellId === report.shellId ? challenge.concerns : []), [challenge, report.shellId]);
  const q = useQuestions(report, concerns);
  const draft = brokerDraft(report, spec, p, q.picked);
  const [to, setTo] = useState(draft.to.email);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const text = body ?? draft.body;
  const subj = subject ?? draft.subject;

  const record = () => {
    saveThread({ id: `${runId}:${report.shellId}`, shellId: report.shellId, runId, name: report.name, to, subject: subj, body: text, status: "sent-by-you", updatedAt: new Date().toISOString() });
    setFlow({ ...flow, sent: true });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setStatus(`Copied. Paste it into a new email to ${draft.to.label}.`); record(); }
    catch { setStatus("Copy didn't work here. Select the message and copy it instead."); }
  };

  return (
    <div className="broker">
      <section className="broker-step" aria-labelledby="b-msg-h">
        <h2 id="b-msg-h">Your message to {draft.to.label}</h2>
        <p className="muted">Hermit wrote this from what it found. Change anything you like.</p>
        <div className="row-input">
          <label htmlFor="b-to" style={fieldLabel}>To</label>
          <input id="b-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder={draft.to.email ? undefined : "The listing broker's email (it's on the listing)"} />
        </div>
        <div className="row-input">
          <label htmlFor="b-subj" style={fieldLabel}>Subject</label>
          <input id="b-subj" value={subj} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <label htmlFor="b-msg" className="sr-only">Message</label>
        <textarea id="b-msg" className="broker-msg" rows={18} value={text} onChange={(e) => setBody(e.target.value)} />
        <div className="actions">
          <button type="button" className="btn primary big" onClick={copy}><Copy aria-hidden="true" /> Copy message</button>
          <a className="btn big" href={mailtoHref(to, subj, text)} onClick={record}><Mail aria-hidden="true" /> Open in email</a>
          <a className="btn" href={`/packet/${runId}/${report.shellId}?print=1`} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> Attach the tenant packet (PDF)</a>
        </div>
        <p><strong>Hermit never sends anything. You send it yourself.</strong></p>
        <p role="status" className="muted small">{status}</p>
        {flow.sent && (
          <div className="broker-done card pad">
            <p><Check aria-hidden="true" className="inline-icon" /> It&apos;s saved in <Link href="/messages">Messages</Link> so you can find it later.</p>
            <Link className="btn primary" href="/studio">Look at other matches <ArrowRight aria-hidden="true" /></Link>
          </div>
        )}
      </section>

      <section className="broker-step" aria-labelledby="b-q-h">
        <h3 id="b-q-h">Questions in your message</h3>
        <p className="muted">Hermit couldn&apos;t answer these from the scan or public records. Untick any you don&apos;t need.</p>
        <QuestionList q={q} />
        {body !== null && <p><button type="button" className="link-btn" onClick={() => setBody(null)}>You changed the message by hand. Rewrite it with these questions?</button></p>}
      </section>

      {loaded && <PacketExtra report={report} spec={spec} runId={runId} p={p} setP={setP} />}
    </div>
  );
}

// Optional: answer a few questions to fill in the tenant packet. The message never waits on it.
function PacketExtra({ report, spec, runId, p, setP }: { report: ShellReport; spec: RequirementSpec; runId: string; p: Profile; setP: (p: Profile) => void }) {
  const [view, setView] = useState<"closed" | "chat" | "review">("closed");
  const [skipped, setSkipped, skipLoaded] = usePersisted<string[]>("hermit:profile-skipped", []);
  const [edit, setEdit] = useState<AskField | null>(null);
  const [pick, setPick] = useState<AskField | "">("");
  return (
    <section className="broker-step card pad" aria-labelledby="b-pk-h">
      <h3 id="b-pk-h">Make my packet stronger (optional)</h3>
      <p className="muted">A short tenant packet shows the listing contact you&apos;re serious: your business, your money and your plans. Your message works without it.</p>
      {view === "closed" && (
        <div className="actions">
          <button type="button" className="btn" onClick={() => setView("chat")}><Pencil aria-hidden="true" /> Make my packet stronger</button>
          <button type="button" className="btn" onClick={() => setView("review")}><Eye aria-hidden="true" /> See my packet</button>
        </div>
      )}
      {view === "chat" && skipLoaded && (
        <DetailsChat key={edit ?? "start"} p={p} setP={setP} skipped={skipped} setSkipped={setSkipped} spec={spec} report={report} edit={edit} onDone={() => { setEdit(null); setView("review"); }} />
      )}
      {view === "review" && (
        <>
          <PacketDoc report={report} spec={spec} runId={runId} profile={p} />
          <div className="actions">
            <a className="btn primary" href={`/packet/${runId}/${report.shellId}?print=1`} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> Download PDF</a>
            <span className="broker-edit">
              <label htmlFor="b-edit" className="sr-only">Detail to change</label>
              <select id="b-edit" value={pick} onChange={(e) => setPick(e.target.value as AskField | "")}>
                <option value="">Change something…</option>
                {askList(spec).map((x) => <option key={x.field} value={x.field}>{x.label}</option>)}
              </select>
              <button type="button" className="btn" disabled={!pick} onClick={() => { if (pick) { setEdit(pick); setPick(""); setView("chat"); } }}><Pencil aria-hidden="true" /> Edit</button>
            </span>
            <button type="button" className="link-btn" onClick={() => setView("closed")}>Hide the packet</button>
          </div>
        </>
      )}
    </section>
  );
}

function DetailsChat({ p, setP, skipped: skipped0, setSkipped: saveSkipped, spec, report, edit, onDone }: { p: Profile; setP: (p: Profile) => void; skipped: string[]; setSkipped: (s: string[]) => void; spec: ReportCtx["spec"]; report: ReportCtx["report"]; edit: AskField | null; onDone: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [done, setDone] = useState(false);
  const [skipped, setSkippedState] = useState(skipped0);
  const setSkipped = (s: string[]) => { setSkippedState(s); saveSkipped(s); };
  const started = useRef(false);
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
    if (started.current) return; // StrictMode runs mount effects twice
    started.current = true;
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
    <div className="broker-step">
      <ul className="broker-chat" aria-live="polite" aria-label="Packet questions">
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
        {done ? <button type="button" className="btn primary big" onClick={onDone}>Look at your packet <ArrowRight aria-hidden="true" /></button>
          : <button type="button" className="link-btn" onClick={onDone}>Skip the rest and look at my packet →</button>}
      </div>
    </div>
  );
}
