import { useCategory } from "../reason/rules";

// The use label shown everywhere (chat, packet, LOI, results): "pediatric clinic", never "own clinic".
// The parser keeps the word before the noun ("my own clinic" → "own clinic"), so filler words are dropped here
// and a named specialty ("I'm a pediatrician") wins over the generic noun.

const SPECIALTY: [RegExp, string][] = [
  [/\bp(a)?ediatric|\bp(a)?ediatrician|\bchildren'?s (doctor|clinic|practice)|\bkids'? (doctor|clinic)/, "pediatric clinic"],
  [/\bdent(ist|al)\b|\borthodont/, "dental clinic"],
  [/\bchiropract/, "chiropractic clinic"],
  [/\bphysical therap|\bphysio(therap)?/, "physical therapy clinic"],
  [/\bveterinar|\bvet (clinic|practice|office)\b|\bi'?m a vet\b/, "veterinary clinic"],
  [/\bdermatolog/, "dermatology clinic"],
  [/\boptometr|\beye doctor|\beye clinic/, "eye clinic"],
  [/\bfamily (doctor|medicine|practice|physician)/, "family medicine clinic"],
  [/\burgent care\b/, "urgent care clinic"],
  [/\bpodiatr/, "podiatry clinic"],
];
const FILLER = new Set(["own", "my", "our", "their", "his", "her", "first", "new", "little", "tiny", "small", "big", "large", "very", "real", "sole", "dream", "a", "an", "the", "next", "same", "local", "open", "opening", "start", "starting"]);

/** A natural label for `useType`; `text` is what the user said, used to spot a named specialty. */
export function cleanUse(useType: string, text = ""): string {
  const t = text.toLowerCase();
  const words = useType.toLowerCase().trim().split(/\s+/).filter((w) => w && !FILLER.has(w));
  let label = words.join(" ");
  if (!label) return useType.trim() === "" ? "" : "office";
  const medical = useCategory(label) === "medical" || (label === "practice" && /doctor|medical|physician|patient|nurse|clinic/.test(t));
  const hit = SPECIALTY.find(([re]) => re.test(t) || re.test(label));
  if ((medical || label === "practice") && hit) return hit[1];
  if (label === "clinic" || (label === "practice" && medical)) return "medical clinic";
  return label;
}
