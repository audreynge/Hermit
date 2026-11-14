import { Suspense } from "react";
import { Hermit } from "@/components/studio/Hermit";

export default function Home() {
  return <Suspense fallback={<p>Loading…</p>}><Hermit /></Suspense>;
}
