"use client";
import { Loader, Mic as Mic2, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ElevenLabs voice: read a reply aloud (/api/tts) and dictate a message (/api/stt).
// One clip at a time across all messages; starting a new one stops the previous.
let stopCurrent: (() => void) | null = null;

export function Speak({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const toggle = async () => {
    if (state === "loading" || state === "playing") { stop.current?.(); return; }
    stopCurrent?.();
    setState("loading");
    const ctl = new AbortController();
    let audio: HTMLAudioElement | null = null, url = "";
    const end = () => { ctl.abort(); audio?.pause(); if (url) URL.revokeObjectURL(url); if (stopCurrent === end) stopCurrent = null; setState((s) => (s === "error" ? s : "idle")); };
    stop.current = stopCurrent = end;
    try {
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 2500) }), signal: ctl.signal });
      if (!r.ok) throw new Error(String(r.status));
      url = URL.createObjectURL(await r.blob());
      audio = new Audio(url);
      audio.onended = end;
      await audio.play();
      setState("playing");
    } catch (e) {
      if (ctl.signal.aborted) return;
      end(); setState("error");
    }
  };
  const label = state === "playing" ? "Stop reading" : state === "loading" ? "Loading audio, click to cancel" : state === "error" ? "Audio unavailable, try again" : "Read aloud";
  return (
    <button type="button" className="speak" onClick={toggle} aria-label={label} title={label} aria-pressed={state === "playing"}>
      {state === "playing" || state === "loading" ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      <span>{state === "playing" ? "Stop" : state === "loading" ? "Loading…" : state === "error" ? "Retry" : "Listen"}</span>
    </button>
  );
}

export function Mic({ disabled, onText }: { disabled: boolean; onText: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "transcribing" | "error">("idle");
  const rec = useRef<MediaRecorder | null>(null);
  useEffect(() => () => { rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream), chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", new Blob(chunks, { type: r.mimeType }));
          const res = await fetch("/api/stt", { method: "POST", body: fd });
          if (!res.ok) throw new Error(String(res.status));
          const { text } = (await res.json()) as { text: string };
          if (text) onText(text);
          setState("idle");
        } catch { setState("error"); }
      };
      rec.current = r; r.start(); setState("recording");
    } catch { setState("error"); }
  };
  const label = state === "recording" ? "Stop recording and transcribe" : state === "transcribing" ? "Transcribing…" : state === "error" ? "Microphone or transcription failed, try again" : "Speak your message";
  return (
    <button type="button" className="icon-btn mic" data-state={state} aria-label={label} title={label} aria-pressed={state === "recording"}
      disabled={disabled || state === "transcribing"} onClick={() => (state === "recording" ? rec.current?.stop() : void start())}>
      {state === "recording" ? <Square aria-hidden="true" /> : state === "transcribing" ? <Loader aria-hidden="true" /> : <Mic2 aria-hidden="true" />}
    </button>
  );
}
