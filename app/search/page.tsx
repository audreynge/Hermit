import { Suspense } from "react";
import { PageHead } from "@/components/Chrome";
import { SearchChat } from "@/components/SearchChat";

export const metadata = { title: "Search · Hermit" };

export default function SearchPage() {
  return (
    <>
      <PageHead title="Search with Hermit" sub="Tell us what kind of space you need, and I'll find the best matches for you." />
      <Suspense fallback={<p>Loading…</p>}><SearchChat /></Suspense>
    </>
  );
}
