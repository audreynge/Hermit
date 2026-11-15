// Test phrases for the offline parser and the live Gemini check (G4.2): phrase, selected id, expected ops.
// The room holds f1 stove, f2 sofa, f3 bar stool.
export const PHRASES: [string, string | undefined, object[]][] = [
  ["put a stove here", undefined, [{ op: "add", name: "stove", at: "point" }]],
  ["add a sofa", undefined, [{ op: "add", name: "sofa", at: "front" }]],
  ["place a fridge against the wall", undefined, [{ op: "add", name: "fridge", at: "wall" }]],
  ["add two bar stools", undefined, [{ op: "add", name: "bar stool", at: "front", count: 2 }]],
  ["put a dining table in the middle of the room", undefined, [{ op: "add", name: "dining table", at: "center" }]],
  ["add a red armchair here", undefined, [{ op: "add", name: "armchair", at: "point", color: "red" }]],
  ["remove the sofa", undefined, [{ op: "remove", id: "f2" }]],
  ["delete it", "f1", [{ op: "remove", id: "f1" }]],
  ["move the sofa here", undefined, [{ op: "move", id: "f2", at: "point" }]],
  ["move it against the wall", "f1", [{ op: "move", id: "f1", at: "wall" }]],
  ["rotate the stove 90 degrees", undefined, [{ op: "rotate", id: "f1", degrees: 90 }]],
  ["turn it around", "f2", [{ op: "rotate", id: "f2", degrees: 180 }]],
  ["make the stove red", undefined, [{ op: "recolor", id: "f1", color: "red" }]],
  ["make it stainless steel", "f1", [{ op: "recolor", id: "f1", material: "stainless steel" }]],
  ["change the sofa to leather", undefined, [{ op: "recolor", id: "f2", material: "leather" }]],
  ["swap the sofa for a sectional", undefined, [{ op: "swap", id: "f2", name: "sectional" }]],
  ["make it 30 inches wide", "f1", [{ op: "resize", id: "f1", w: 0.762 }]],
  ["set the height of the sofa to 3 ft", undefined, [{ op: "resize", id: "f2", h: 0.9144 }]],
  ["make the stove 20% bigger", undefined, [{ op: "resize", id: "f1", scale: 1.2 }]],
  ["make it half the size", "f3", [{ op: "resize", id: "f3", scale: 0.5 }]],
];
