import { redirect } from "next/navigation";

// The old search chat merged into Find a space.
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString();
  redirect(qs ? `/studio?${qs}` : "/studio");
}
