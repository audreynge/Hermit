// Follow-ups answered in the browser, without a server round trip.
export type LocalCommand = "search" | "undo" | "keep" | "studio" | "parcel";

const RULES: [LocalCommand, RegExp][] = [
  ["search", /^search with this$/i],
  ["undo", /^undo( (that|it|the last change))?$/i],
  ["keep", /^keep( these changes| it)?$/i],
  ["studio", /^(open (the layout|in layout studio)|draw a layout)$/i],
  ["parcel", /\b(parcel|apn)\b/i],
  ["parcel", /^(what|what's|whats|how (big|much|large)|when)\b.*\b(lot|property tax(es)?|taxes|assess(ed|ment)|last (sold|sale)|sold)\b/i],
];

export const localCommand = (text: string): LocalCommand | null => RULES.find(([, re]) => re.test(text.trim()))?.[0] ?? null;

// True when the text asks to change the drawn layout (add/remove/resize/move a room).
export const isLayoutEdit = (_text: string): boolean => false;
