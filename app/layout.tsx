import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import { Decor, Header } from "@/components/Chrome";
import "./globals.css";

const body = Nunito({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Hermit",
  description: "Find a space that already fits. Hermit finds spaces already built for what you need and shows what's left to do.",
  icons: { icon: "/hermit-logo.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={body.variable} suppressHydrationWarning>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <Decor />
        <Header />
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
