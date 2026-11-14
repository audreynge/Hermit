"use client";
import { Bookmark, Home, MapPin, MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SettingsButton } from "./Settings";

const NAV = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/studio", label: "Find a space", Icon: Search },
  { href: "/address", label: "Check an address", Icon: MapPin },
  { href: "/saved", label: "Saved", Icon: Bookmark },
  { href: "/messages", label: "Messages", Icon: MessageSquare },
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
          <Link key={href} href={href} aria-current={(href === "/" ? path === "/" : path.startsWith(href) || (href === "/studio" && path.startsWith("/shell"))) ? "page" : undefined}>
            <Icon aria-hidden="true" strokeWidth={1.8} /> <span>{label}</span>
          </Link>
        ))}
      </nav>
      <SettingsButton />
    </header>
  );
}
