import { PageHead } from "@/components/Chrome";
import { LayoutStudio } from "@/components/LayoutStudio";

export const metadata = { title: "Layout · Hermit" };

export default function LayoutPage() {
  return (
    <>
      <PageHead title="Build your layout" sub="Drag and drop room blocks to sketch the space you need." />
      <LayoutStudio />
    </>
  );
}
