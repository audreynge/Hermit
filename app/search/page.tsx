import { redirect } from "next/navigation";

// Survey, search and layout are one flow now.
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString();
  redirect(qs ? `/studio?${qs}` : "/studio");
}
