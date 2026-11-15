import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import { Header } from "@/components/Chrome";
import { Decor } from "@/components/Decor";
import "./globals.css";
import "./studio.css";
import "./round3.css";
import "@/components/coastal/hermit-components.css";
import "./coastal.css";

const body = Nunito({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Hermit",
  description: "Hermit interviews you like an expert, sketches the space you need, then walks inside every scan that could fit to find the one already built for it.",
  icons: { icon: "/hermit-logo.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={body.variable} suppressHydrationWarning>
      <head>
        {/* Apply saved theme before paint so the theme does not flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var s=JSON.parse(localStorage.getItem("hermit:settings")||"{}");var e=document.documentElement;if(s.theme==="system")e.removeAttribute("data-theme");else e.dataset.theme=s.theme||"light";if(s.text)e.dataset.text=s.text;if(s.motion)e.dataset.motion=s.motion}catch(_){}` }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <Decor />
        <Header />
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
