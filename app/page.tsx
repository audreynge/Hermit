import { Hero } from "@/components/Hero";
import { loadShells } from "@/lib/query/load";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Hero total={loadShells().length} />;
}
