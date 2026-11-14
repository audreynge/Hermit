import { useCategory } from "./rules";
import type { RoomGraph } from "../types";

// "Is the build-out really there?" The Inspector tags what the scan can show for this use. Anything it can't confirm
// is "unverified" and becomes a question; things only the scan's AI-written description mentions are "mentioned".
export type BuildItem = { item: string; status: "seen" | "mentioned" | "unverified"; evidence: string; question: string };

type Check = { item: string; objects: RegExp; rooms?: RegExp; words: RegExp; question: string };
const C = {
  restroom: { item: "Restrooms", objects: /toilet/, rooms: /bath|restroom|toilet|powder|wc/, words: /restroom|bathroom|toilet|lavatory/, question: "How many restrooms are in the space, and are they accessible?" },
  sink: { item: "Sinks", objects: /sink/, rooms: /kitchen|bath|restroom|utility|laundry/, words: /\bsinks?\b/, question: "Where are the existing sinks and water lines?" },
  hood: { item: "Kitchen hood", objects: /hood|range|stove|oven/, words: /\bhood\b|exhaust|range hood/, question: "Is there a working commercial hood and exhaust to the roof?" },
  drain: { item: "Floor drains", objects: /drain/, words: /floor drain/, question: "Are there floor drains, and where?" },
  walkin: { item: "Walk-in cooler", objects: /walk-?in|cooler|freezer/, rooms: /walk-?in|cooler|freezer/, words: /walk-?in|cooler|freezer/, question: "Is there a walk-in cooler or freezer, and does it work?" },
  grease: { item: "Grease interceptor", objects: /^$/, words: /grease (trap|interceptor)/, question: "Is there a grease interceptor, and what size?" },
  shampoo: { item: "Shampoo bowls", objects: /shampoo/, words: /shampoo/, question: "Are there shampoo bowls with hot water at the styling floor?" },
  heater: { item: "Water heater", objects: /water heater|boiler/, rooms: /mechanical|utility/, words: /water heater/, question: "What size is the water heater?" },
  exam: { item: "Exam-room sinks", objects: /sink/, words: /exam[^.]*sink|sink[^.]*exam/, question: "Do the exam rooms have their own sinks?" },
} satisfies Record<string, Check>;

const FOR_USE: Record<string, (keyof typeof C)[]> = {
  restaurant: ["hood", "sink", "drain", "walkin", "grease", "restroom"],
  salon: ["shampoo", "sink", "heater", "restroom"],
  medical: ["exam", "sink", "restroom"],
  fitness: ["restroom", "heater"],
  retail: ["restroom", "sink"],
  office: ["restroom", "sink"],
  warehouse: ["restroom", "drain"],
  manufacturing: ["restroom", "drain"],
  home: ["restroom", "sink", "heater"],
};

export function buildoutCheck(useType: string, graph: RoomGraph | null): BuildItem[] {
  const use = useCategory(useType);
  const keys = FOR_USE[use] ?? FOR_USE.office;
  const desc = (graph?.description ?? "").toLowerCase();
  return keys.map((k) => {
    const c: Check = C[k];
    if (!graph) return { item: c.item, status: "unverified", evidence: "No scan for this space", question: c.question };
    const obj = graph.objects.find((o) => c.objects.test(o.label));
    if (obj) return { item: c.item, status: "seen", evidence: `Seen in the scan (${obj.label})`, question: c.question };
    const room = c.rooms ? graph.rooms.find((r) => c.rooms!.test(r.rawTags.join(" ").toLowerCase()) || c.rooms!.test(r.label)) : undefined;
    // A tagged bathroom shows a restroom; it doesn't prove a sink is where you need it, except for the sink check itself.
    if (room && (k === "restroom" || k === "sink" || k === "walkin" || k === "heater")) return { item: c.item, status: "seen", evidence: `Room tagged ${room.rawTags[0] ?? room.label} in the scan`, question: c.question };
    if (c.words.test(desc)) return { item: c.item, status: "mentioned", evidence: "Mentioned in the scan's AI-written description, not tagged", question: c.question };
    return { item: c.item, status: "unverified", evidence: k === "grease" ? "Never visible in a scan: it's under the floor" : "Not seen in the scan", question: c.question };
  });
}
