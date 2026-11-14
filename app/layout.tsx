import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Young_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-body" });
const display = Young_Serif({ subsets: ["latin"], weight: "400", variable: "--font-display" });

export const metadata: Metadata = {
  title: "Hermit",
  description: "Find the space already built for what you need, and see what's left to do.",
};

function Shell() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 24c0-9 5-16 12-16 5 0 8 4 8 9 0 4-3 7-7 7-3 0-5-2-5-5 0-2 1.5-3.5 3.5-3.5" />
      <path d="M4 24h24" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="top">
          <Link href="/" className="brand"><Shell /> Hermit</Link>
          <nav aria-label="Primary">
            <Link href="/plan">Plan a search</Link>
            <Link href="/results?replay=demo">Replay demo</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
