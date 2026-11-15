import { SavedList } from "@/components/Inboxes";

export const metadata = { title: "Saved · Hermit" };
export default function SavedPage() {
  return <div className="narrow"><header className="page-intro"><h1>Saved spaces</h1><p>Shells you&apos;ve hearted, with their full reports.</p></header><SavedList /></div>;
}
