import { ArrowRight, PlayCircle } from "lucide-react";
import Link from "next/link";

export function Hero({ total }: { total: number }) {
  return (
    <div className="hero">
      <section className="hero-top" aria-labelledby="hero-title">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hermit-logo.svg" alt="" className="hero-crab" width={180} height={170} />
        <div>
          <h1 id="hero-title">Hermit crabs don&apos;t build their shells.<br /><span>They find one that already fits.</span></h1>
          <p className="hero-sub">Tell Hermit what you&apos;re opening. It walks inside {total.toLocaleString()} scanned spaces in Houston and Los Angeles, finds the one that&apos;s already built for you, and tells you what&apos;s left to do, in plain words.</p>
          <form action="/studio" className="hero-form" role="search">
            <label htmlFor="hero-q" className="sr-only">What are you opening?</label>
            <input id="hero-q" name="q" placeholder="What are you opening? e.g. a salon in Houston" autoComplete="off" />
            <button type="submit" className="cta">Find my shell <ArrowRight aria-hidden="true" /></button>
          </form>
          <p className="hero-demo"><Link href="/studio?replay=demo"><PlayCircle aria-hidden="true" /> Watch a recorded run</Link></p>
        </div>
      </section>
    </div>
  );
}
