import { objectType, roomType } from "../design/rooms";

// Follow-ups answered in the browser, without a server round trip.
export type LocalCommand = "search" | "reset" | "undo" | "keep" | "studio" | "parcel";

const RULES: [LocalCommand, RegExp][] = [
  ["search", /^(search with this|search now|just search|run (the |a )?search|find (me )?(matches|spaces)|(see|show me) (my |the )?matches)[.!]?$/i],
  ["reset", /^(start (over|again|fresh)|reset|new search|clear everything)[.!]?$/i],
  ["undo", /^undo( (that|it|the last change))?$/i],
  ["keep", /^keep( these changes| it)?$/i],
  ["studio", /^(open (the layout|in layout studio)|draw a layout)$/i],
  ["parcel", /\b(parcel|apn)\b/i],
  ["parcel", /^(what|what's|whats|how (big|much|large)|when)\b.*\b(lot|property tax(es)?|taxes|assess(ed|ment)|last (sold|sale)|sold)\b/i],
];

export const localCommand = (text: string): LocalCommand | null => RULES.find(([, re]) => re.test(text.trim()))?.[0] ?? null;

// Questions and search wording ("find a bigger office") go to the interview, not the layout.
const QUESTION = /^(what|what's|whats|how|why|when|where|who|which|is|are|does|do|did|should|will)\b|\b(find|search|looking for|look for|show me|make room for)\b|\b\d+\s+(people|persons|employees|staff|workers|guests)\b/;
const EDIT_VERB = /\b(add|remove|delete|drop|get rid of|take out|cut|resize|move|shift|swap|put|place|rename|relabel|make|turn|convert|change|merge|combine|split|divide|enlarge|expand|shrink|widen|double|halve|edit)\b|\b(\d+|one|two|three|four|five|a few|a couple( of)?)\s+(more|fewer|less|extra)\b|\banother\b|\b(bigger|smaller|larger|wider|narrower|tinier)\b/;
const LAYOUT_NOUN = /\b(rooms?|layout|floor ?plan|walls?)\b/;

const mentionsRoom = (t: string) => {
  const w = t.match(/[a-z]+/g) ?? [];
  for (let i = 0; i < w.length; i++) for (let n = 1; n <= 3 && i + n <= w.length; n++) {
    const span = w.slice(i, i + n).join(" ");
    if (span !== "other" && (roomType(span) || objectType(span))) return true;
  }
  return false;
};

// True when the text asks to change the drawn layout (add/remove/resize/move/rename a room or a piece of furniture).
export function isLayoutEdit(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t || QUESTION.test(t)) return false;
  return EDIT_VERB.test(t) && (LAYOUT_NOUN.test(t) || mentionsRoom(t));
}
