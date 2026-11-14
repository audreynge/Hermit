"use client";
import { Bookmark, MessageCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Chat", Icon: MessageCircle },
  { href: "/saved", label: "Saved", Icon: Bookmark },
];

export function Header() {
  const path = usePathname();
  return (
    <header className="top">
      <Link href="/" className="brand" aria-label="Hermit home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hermit-logo.svg" alt="" width={92} height={87} />
        Hermit
      </Link>
      <nav className="primary" aria-label="Primary">
        {NAV.map(({ href, label, Icon }) => (
          <Link key={href} href={href} aria-current={(href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined}>
            <Icon aria-hidden="true" strokeWidth={1.8} /> {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function Sparks() {
  return (
    <svg className="sparks" viewBox="0 0 34 34" aria-hidden="true" fill="none" stroke="#f26a4b" strokeWidth="3" strokeLinecap="round">
      <path d="M8 4l2 9" /><path d="M17 12l10-7" /><path d="M20 22l10-1" />
    </svg>
  );
}

export function PageHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="page-head">
      <h1>{title}<Sparks /></h1>
      <p>{sub}</p>
    </div>
  );
}

export function Decor() {
  return (
    <div className="decor" aria-hidden="true">
      <svg className="wave-top" viewBox="0 0 760 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sea" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#bfe9f7" /><stop offset="0.5" stopColor="#7fd0ef" /><stop offset="1" stopColor="#44ade0" />
          </linearGradient>
        </defs>
        <path d="M0 196 C120 196 160 150 260 148 C380 146 420 112 520 92 C620 72 680 40 760 0 L760 200 L0 200 Z" fill="none" />
        <path d="M20 190 C150 186 190 150 290 146 C400 142 450 108 540 86 C640 62 700 26 760 0 L760 120 C700 150 640 160 560 168 C470 176 400 196 300 200 L20 200 Z" fill="url(#sea)" opacity="0.9" />
        <path d="M60 192 C170 186 210 156 300 152 C410 147 455 116 545 94 C640 70 700 34 760 8" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity="0.85" />
        <path d="M430 150 C470 140 500 138 540 128" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.7" fill="none" />
        <g fill="#e6b79e" opacity="0.55">
          <circle cx="520" cy="190" r="2" /><circle cx="560" cy="182" r="1.6" /><circle cx="610" cy="176" r="2.2" /><circle cx="660" cy="188" r="1.6" /><circle cx="700" cy="170" r="2" />
        </g>
      </svg>
      <Shell className="shell-top" />
      <svg className="sand" viewBox="0 0 1440 96" preserveAspectRatio="none">
        <path d="M0 40 C240 10 480 70 760 44 C1020 20 1240 60 1440 36 L1440 96 L0 96 Z" fill="#f8dccb" opacity="0.8" />
        <g fill="#e2b49a" opacity="0.6">
          <circle cx="120" cy="70" r="2" /><circle cx="180" cy="80" r="1.5" /><circle cx="300" cy="64" r="2" /><circle cx="1180" cy="60" r="2" /><circle cx="1220" cy="74" r="1.5" /><circle cx="1300" cy="66" r="2" />
        </g>
      </svg>
      <svg className="star" viewBox="0 0 80 80">
        <path d="M40 6 L49 30 L74 30 L54 46 L62 72 L40 57 L18 72 L26 46 L6 30 L31 30 Z" fill="#f58a6b" stroke="#e46a4a" strokeWidth="2" strokeLinejoin="round" />
        <g fill="#ffd2c2"><circle cx="40" cy="24" r="2" /><circle cx="40" cy="40" r="2.4" /><circle cx="54" cy="36" r="1.6" /><circle cx="26" cy="36" r="1.6" /><circle cx="48" cy="54" r="1.6" /><circle cx="32" cy="54" r="1.6" /></g>
      </svg>
      <Shell className="shell-bottom" />
      <svg className="wave-bottom" viewBox="0 0 260 90" preserveAspectRatio="none">
        <path d="M0 90 C60 60 110 70 160 44 C200 22 230 10 260 0 L260 90 Z" fill="#7fd0ef" opacity="0.85" />
        <path d="M20 86 C70 62 115 70 165 46 C205 26 232 14 260 6" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function Shell({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 64 56">
      <path d="M32 52 C14 52 4 40 6 26 C8 12 20 4 32 4 C44 4 56 12 58 26 C60 40 50 52 32 52 Z" fill="#ffe9dc" stroke="#e8b9a0" strokeWidth="2" />
      <g stroke="#e8b9a0" strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M32 50 L32 8" /><path d="M32 50 L18 12" /><path d="M32 50 L46 12" /><path d="M32 50 L9 26" /><path d="M32 50 L55 26" />
      </g>
      <path d="M24 50 h16 v4 h-16 z" fill="#f2c8b2" />
    </svg>
  );
}
