import { redirect } from "next/navigation";

export default async function SearchRedirect({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const qs = new URLSearchParams(await searchParams).toString();
  redirect(qs ? `/?${qs}` : "/");
}
