import { Bookmark, PlayCircle, Search, Store } from "lucide-react";
import Link from "next/link";

const TILES = [
  { icon: Store, title: "Find a space", text: "Tell Hermit what you're opening. It finds scanned spaces already built for it and tells you what's left to do.", cta: "Start searching", href: "/studio" },
  { icon: PlayCircle, title: "Watch a run", text: "See Hermit interview an owner, walk inside real spaces and pick the one that fits.", cta: "Watch a recorded run", href: "/studio?replay=demo" },
  { icon: Bookmark, title: "Your saved spaces", text: "Come back to the spaces you liked, compare them and talk to the landlord.", cta: "See saved spaces", href: "/saved" },
];

export function Hero() {
  return (
    <div className="zhero">
      <section className="zhero-banner" aria-labelledby="hero-title">
        <div className="zhero-inner">
          <h1 id="hero-title">Find the shell that already fits.</h1>
          <form action="/studio" className="zhero-search" role="search">
            <label htmlFor="hero-q" className="sr-only">What are you opening?</label>
            <input id="hero-q" name="q" placeholder="What are you opening? e.g. a salon in Houston" autoComplete="off" />
            <button type="submit" aria-label="Search"><Search aria-hidden="true" /></button>
          </form>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hermit-logo.svg" alt="" className="zhero-crab" />
      </section>

      <section className="zhero-tiles" aria-label="What you can do">
        {TILES.map(({ icon: Icon, title, text, cta, href }) => (
          <div key={title} className="zhero-tile">
            <span className="zhero-icon"><Icon aria-hidden="true" /></span>
            <h2>{title}</h2>
            <p>{text}</p>
            <Link href={href} className="zhero-cta">{cta}</Link>
          </div>
        ))}
      </section>
    </div>
  );
}
