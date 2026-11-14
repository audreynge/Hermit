import { Suspense } from "react";
import { Hermit } from "@/components/studio/Hermit";

export const metadata = { title: "Find a space · Hermit" };

export default function StudioPage() {
  return <Suspense fallback={<p>Loading…</p>}><Hermit /></Suspense>;
}
