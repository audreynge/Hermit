import { Suspense } from "react";
import { Hermit } from "@/components/studio/Hermit";

// The studio flow from the UI overhaul: interview, sketch, crew trace and shell reports on one page.
export default function StudioPage() {
  return <Suspense fallback={<p>Loading…</p>}><Hermit /></Suspense>;
}
