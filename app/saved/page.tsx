import { PageHead } from "@/components/Chrome";
import { SavedList } from "@/components/SavedList";

export const metadata = { title: "Saved · Hermit" };

export default function SavedPage() {
  return (
    <>
      <PageHead title="Saved spaces" sub="Spaces you've bookmarked, with their full reports and email drafts." />
      <SavedList />
    </>
  );
}
