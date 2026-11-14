"use client";
import { Mic, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ChatMsg = { id: string; role: "hermit" | "user"; text: string; why?: string; quick?: string[]; multi?: boolean; cta?: boolean; agent?: string };

type SpeechRec = { lang: string; interimResults: boolean; start: () => void; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void };

export function Interview({ messages, busy, onSend, children, placeholder }: { messages: ChatMsg[]; busy: boolean; onSend: (t: string) => void; children?: React.ReactNode; placeholder?: string }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  // Sketch notes don't replace the question still waiting for an answer.
  const last = [...messages].reverse().find((m) => m.role === "hermit" && m.agent !== "sketch");

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages, busy]);

  const send = (t: string) => { if (!t.trim() || busy) return; onSend(t.trim()); setText(""); };
  // Voice input exists only in some browsers; detect after mount so server and client render the same markup.
  const [speech, setSpeech] = useState<(new () => SpeechRec) | undefined>(undefined);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (ctor) setSpeech(() => ctor);
  }, []);
  const listen = () => {
    if (!speech) return;
    const r = new speech();
    r.lang = "en-US"; r.interimResults = false;
    r.onresult = (e) => setText((t) => `${t} ${e.results[0][0].transcript}`.trim());
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };

  return (
    <section className="card interview" aria-label="Interview with Hermit">
      <div className="messages" ref={scroller} aria-live="polite" aria-label="Conversation">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "hermit" && <span className="avatar bot" aria-hidden="true">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/hermit-logo.svg" alt="" /></span>}
            <div className="bubbles">
              <div className="bubble"><span className="sr-only">{m.role === "hermit" ? "Hermit: " : "You: "}</span>{m.text}</div>
              {m.why && <p className="why">{m.why}</p>}
            </div>
          </div>
        ))}
        {busy && <div className="msg hermit"><span className="avatar bot" aria-hidden="true">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/hermit-logo.svg" alt="" /></span><div className="bubble typing" aria-label="Hermit is thinking"><span /><span /><span /></div></div>}
      </div>
      {last?.quick?.length && !busy ? (
        last.multi ? (
          <div className="quick" role="group" aria-label="Pick any that matter">
            {last.quick.map((q) => <button key={q} type="button" aria-pressed={picked.includes(q)} onClick={() => setPicked((p) => (p.includes(q) ? p.filter((x) => x !== q) : [...p, q]))}>{q}</button>)}
            <button type="button" className="done" onClick={() => { send(picked.length ? `Must-haves: ${picked.join(", ")}` : "None of these"); setPicked([]); }}>{picked.length ? `Done (${picked.length})` : "None of these"}</button>
          </div>
        ) : (
          <div className="quick" role="group" aria-label="Suggested replies">
            {last.quick.map((q) => <button key={q} type="button" onClick={() => send(q)}>{q}</button>)}
          </div>
        )
      ) : null}
      {children}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <label className="sr-only" htmlFor="composer">Message Hermit</label>
        <input id="composer" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? "Answer, or describe anything else you need…"} autoComplete="off" />
        {speech && <button type="button" className="icon-btn" onClick={listen} aria-pressed={listening} aria-label={listening ? "Listening" : "Speak your answer"}><Mic aria-hidden="true" /></button>}
        <button type="submit" className="send" disabled={!text.trim() || busy} aria-label="Send"><Send aria-hidden="true" /></button>
      </form>
    </section>
  );
}
