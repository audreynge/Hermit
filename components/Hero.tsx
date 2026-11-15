/* eslint-disable @next/next/no-img-element -- small decorative sprites placed by percentage on the beach stage */
import { ArrowRight, Layers, MapPinned, Search } from "lucide-react";
import Link from "next/link";
import type { SVGProps } from "react";
import { Sparks } from "./Chrome";

const B = "/hermit-assets/beach";

// Floor-plan outline (an L-shaped room with a door gap), matching the reference icon.
function PlanIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round" {...props}>
      <path d="M4 4h16v16H4z" /><path d="M13 4v6h7" /><path d="M4 14h5v6" />
    </svg>
  );
}

const PATHS = [
  { href: "/studio", Icon: MapPinned, title: "Find a Space", text: "Search commercial spaces that fit your business and key requirements." },
  { href: "/saved", Icon: Layers, title: "Compare Options", text: "Evaluate side-by-side details, layouts, and tradeoffs." },
  { href: "/studio", Icon: PlanIcon, title: "Plan Your Layout", text: "Explore capacity, fit, and layout options for your team." },
];

// The beach behind the page. The stage keeps the background's 1672×941 proportions (CSS cover),
// so every prop is placed in percentages of the same picture and stays where the reference puts it.
function BeachScene() {
  return (
    <div className="beach-scene" aria-hidden="true">
      <div className="beach-stage">
        <div className="sea-shimmer" />
        <span className="beach-shadow" />
        <img className="beach-wave wave-drift" src={`${B}/water-bottom.webp`} alt="" width={1600} height={236} />
        <img className="beach-crab" src={`${B}/crab.webp`} alt="" width={420} height={318} />
        <img className="beach-shell hermit-starfish-motion" src={`${B}/shell-cowrie.webp`} alt="" width={180} height={118} />
        <svg className="beach-rock" viewBox="0 0 60 16">
          <defs><radialGradient id="rock" cx="40%" cy="30%" r="70%"><stop offset="0" stopColor="#a9abb3" /><stop offset="1" stopColor="#6f727c" /></radialGradient></defs>
          <ellipse cx="17" cy="10" rx="16" ry="5.5" fill="#d9b7a2" opacity="0.5" />
          <ellipse cx="17" cy="8" rx="15" ry="6" fill="url(#rock)" />
          <ellipse cx="13" cy="6" rx="5" ry="1.6" fill="#fff" opacity="0.35" />
          <ellipse cx="51" cy="11" rx="4.5" ry="2" fill="#e2b29a" />
        </svg>
        <svg className="beach-steps" viewBox="0 0 130 52">
          {[[119, 6], [98, 11], [78, 18], [55, 25], [31, 31], [8, 37], [42, 38], [17, 45]].map(([x, y]) => (
            <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="5.5" ry="2.2" transform={`rotate(-14 ${x} ${y})`} />
          ))}
        </svg>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <div className="hero">
      <BeachScene />
      <section className="hero-copy" aria-labelledby="hero-title">
        <h1 id="hero-title"><Sparks />Find a space <br />that <em>already fits.</em></h1>
        <p className="hero-sub">Hermit helps businesses find prebuilt commercial spaces that already match their needs.</p>
        <form action="/studio" className="hero-form" role="search">
          <Search aria-hidden="true" className="hero-form-icon" />
          <label htmlFor="hero-q" className="sr-only">What are you opening?</label>
          <input id="hero-q" name="q" placeholder="What are you opening? e.g. a clinic in Houston" autoComplete="off" />
          <button type="submit">Find my shell <ArrowRight aria-hidden="true" /></button>
        </form>
      </section>

      <nav className="hero-paths" aria-label="What you can do">
        {PATHS.map(({ href, Icon, title, text }, i) => (
          <Link key={title} href={href} className="hero-path hermit-interactive hermit-enter" style={{ animationDelay: `${i * 70}ms` }}>
            <span className="hero-path-icon"><Icon aria-hidden="true" strokeWidth={1.6} /></span>
            <span className="hero-path-text"><strong>{title}</strong><span>{text}</span></span>
            <span className="hero-path-go"><ArrowRight aria-hidden="true" /></span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
