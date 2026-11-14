import { PageHead } from "@/components/Chrome";
import { Survey } from "@/components/Survey";

export default function SurveyPage() {
  return (
    <>
      <PageHead title="Find a space that already fits" sub="Tell us what you need, and we'll find spaces that match." />
      <Survey />
    </>
  );
}
