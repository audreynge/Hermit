import Link from "next/link";
import { SettingsButton } from "./Settings";

export function Header() {
  return (
    <header className="top">
      <Link href="/" className="brand" aria-label="Hermit home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hermit-logo.svg" alt="" width={92} height={87} />
        Hermit
      </Link>
      <p className="tagline">Tell me what you need. I&apos;ll find the space that&apos;s already built for it, and show you what&apos;s left to do.</p>
      <SettingsButton />
    </header>
  );
}
