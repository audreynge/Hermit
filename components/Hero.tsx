import { ArrowRight, PlayCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

// Screenshots come from the recorded demo via scripts/hero-shots.ts (synthetic sample data only).

export function Hero({ total }: { total: number }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title">
          Hermit crabs don&apos;t build their shells.
          <span>They find one that already fits.</span>
        </h1>
        <p className="hero-sub">Tell Hermit what you&apos;re opening. It walks inside {total.toLocaleString()} scanned spaces in Houston and Los Angeles, finds the one that&apos;s already built for you, and tells you what&apos;s left to do.</p>
        <form action="/studio" className="hero-form" role="search">
          <label htmlFor="hero-q" className="sr-only">What are you opening?</label>
          <input id="hero-q" name="q" placeholder="e.g. a nail salon in Houston" autoComplete="off" />
          <button type="submit">Find my shell <ArrowRight aria-hidden="true" /></button>
        </form>
        <p className="hero-demo"><Link href="/studio?replay=demo"><PlayCircle aria-hidden="true" /> Watch a recorded run</Link></p>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="hero-window">
          <div className="hero-window-bar">Sample Medical Suite 210 · measured floor plan</div>
          <Image src="/hero/floor-plan.png" width={1420} height={916} alt="" sizes="600px" priority />
        </div>
        <Image className="hero-float hero-float-match" src="/hero/match-card.png" width={634} height={600} alt="" sizes="200px" />
        <Image className="hero-float hero-float-verdict" src="/hero/verdict-card.png" width={1408} height={274} alt="" sizes="460px" />
      </div>
    </section>
  );
}
