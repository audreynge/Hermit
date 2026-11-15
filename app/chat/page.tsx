import { Suspense } from "react";
import { PageHead } from "@/components/Chrome";
import { SearchChat } from "@/components/SearchChat";

export const metadata = { title: "Chat · Hermit" };

// The original search chat: free-form chat, compare, email drafts, parcel info and layout edits.
export default function ChatPage() {
  return (
    <>
      <PageHead title="Find a space that already fits" sub="Tell Hermit what you need. It asks a few quick questions, then finds spaces already built for it." />
      <Suspense fallback={<p>Loading…</p>}><SearchChat /></Suspense>
    </>
  );
}
