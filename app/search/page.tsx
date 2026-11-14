import { redirect } from "next/navigation";

// Survey, search and layout are one flow now.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ replay?: string }> }) {
  const { replay } = await searchParams;
  redirect(replay ? `/studio?replay=${encodeURIComponent(replay)}` : "/studio");
}
