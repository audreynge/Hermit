"use client";
import { Car, MapPin, Search, Store, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { savedShells } from "@/lib/client/persist";
import { USE_OPTIONS } from "@/lib/spec/survey";
import type { Answer } from "@/lib/neighborhood/summarize";

type Result = {
  match: { lat: number; lon: number; label: string }; city: string;
  answers: { customers: Answer; neighbors: Answer; competitors: Answer };
  nearest: { id: string; sid?: string; name: string; address: string; sqft?: number; kind?: string; miles?: number }[];
  similar: { id: string; sid?: string; name: string; address: string; sqft?: number; kind?: string }[];
};
const EXAMPLES = ["1311 Westheimer Rd, Houston, TX 77006", "3700 Wilshire Blvd, Los Angeles, CA 90010", "2450 Fondren Rd, Houston, TX 77063"];

function A({ title, a, Icon }: { title: string; a: Answer; Icon: typeof Car }) {
  return (
    <article className="q-card">
      <h3><Icon aria-hidden="true" className="inline-icon" /> {title}</h3>
      <p className="q-answer">{a.headline}</p>
      <ul>{a.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      {a.missing && <p className="muted small">{a.missing}.</p>}
      <p className="src small">Source: {a.source}{a.proxy ? " (proxy)" : ""}</p>
    </article>
  );
}

export function AddressCheck() {
  const [address, setAddress] = useState("");
  const [use, setUse] = useState("salon");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async (addr: string) => {
    if (!addr.trim()) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await fetch("/api/address", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addr, use, likes: savedShells().map((s) => s.shellId) }) });
      const out = await r.json();
      if (!r.ok) setErr(out.error ?? "Something went wrong."); else setRes(out);
    } catch { setErr("Couldn't reach the server."); } finally { setBusy(false); }
  };
  return (
    <div className="address-page">
      <header className="page-intro">
        <h1>Check an address</h1>
        <p>Already have a place in mind? Hermit tells you who walks and drives by, who lives nearby, and who you&apos;d compete with, then shows the closest spaces it has scanned.</p>
      </header>
      <form className="card pad address-form" onSubmit={(e) => { e.preventDefault(); void check(address); }}>
        <label htmlFor="addr">Street address in Houston or Los Angeles</label>
        <div className="row-input">
          <input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 1311 Westheimer Rd, Houston, TX" autoComplete="street-address" />
          <label className="sr-only" htmlFor="addr-use">What are you opening?</label>
          <select id="addr-use" value={use} onChange={(e) => setUse(e.target.value)}>{USE_OPTIONS.filter((u) => u.mode !== "home").map((u) => <option key={u.value} value={u.useType}>{u.label}</option>)}</select>
          <button type="submit" className="btn primary" disabled={busy}><Search aria-hidden="true" /> {busy ? "Checking…" : "Check it"}</button>
        </div>
        <div className="hero-chips"><span className="muted">Try:</span>{EXAMPLES.map((e) => <button key={e} type="button" className="chip" onClick={() => { setAddress(e); void check(e); }}>{e}</button>)}</div>
      </form>
      {err && <p role="alert" className="card pad">{err}</p>}
      {res && (
        <>
          <p className="found"><MapPin aria-hidden="true" className="inline-icon" /> {res.match.label}</p>
          <div className="q-grid three">
            <A title="Will customers come here?" a={res.answers.customers} Icon={Car} />
            <A title="Who lives and works nearby?" a={res.answers.neighbors} Icon={Users} />
            <A title="Who am I competing with?" a={res.answers.competitors} Icon={Store} />
          </div>
          <section className="card pad" aria-labelledby="near-t">
            <h2 id="near-t">Closest spaces Hermit has walked inside</h2>
            <ul className="shell-list">{res.nearest.map((s) => <li key={s.id}><strong>{s.name}</strong> <span className="muted">{s.address} · {s.sqft ? `${s.sqft.toLocaleString()} sf · ` : ""}{s.miles} mi away</span> <Link href={`/studio?q=${encodeURIComponent(`${use} in ${res.city === "houston" ? "Houston" : "Los Angeles"}`)}`}>Check the fit →</Link></li>)}</ul>
          </section>
          <section className="card pad" aria-labelledby="like-t">
            <h2 id="like-t">Based on what you like</h2>
            {res.similar.length ? <ul className="shell-list">{res.similar.map((s) => <li key={s.id}><strong>{s.name}</strong> <span className="muted">{s.address}{s.sqft ? ` · ${s.sqft.toLocaleString()} sf` : ""}</span></li>)}</ul>
              : <p className="muted">Save a few spaces you like (the heart on any Shell Report) and Hermit will suggest similar ones here.</p>}
          </section>
        </>
      )}
      {!res && !err && <p className="muted small">Uses free public data: TxDOT and Caltrans traffic counts, OpenStreetMap places and transit, and the US Census geocoder.</p>}
    </div>
  );
}
