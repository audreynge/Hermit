import { Suspense } from "react";
import { Results } from "@/components/Results";

export const metadata = { title: "Results · Hermit" };

export default function ResultsPage() {
  return <Suspense fallback={<p>Loading…</p>}><Results /></Suspense>;
}
