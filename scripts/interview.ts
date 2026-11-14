// Plays a scripted interview against the local bundle. Usage: npx tsx --env-file=.env scripts/interview.ts [answers...]
import { interviewTurn, type IState } from "../lib/interview/turn";
import { loadShells } from "../lib/query/load";

const answers = process.argv.slice(2).length ? process.argv.slice(2) : ["Houston", "Restaurant / café", "1,000 – 2,500 sq ft", "In 3–6 months", "Can you make the storage smaller, like 40 sf", "About 10", "Where do I check the details?", "Patio / outdoor seating", "Where is the button?"];
let state: IState = { spec: { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" }, asked: [], history: [] };
const shells = loadShells();
let t = await interviewTurn(state, null, shells);
const show = () => console.log(`HERMIT${t.llm ? " (llm)" : ""}${t.ready ? " [READY]" : ""}${t.basicsDone ? " [sketch]" : ""}: ${t.reply}\n   why: ${t.why ?? "-"} | quick: ${t.quick.slice(0, 4).join(" / ")}\n   counter: ${t.stages.map((s) => s.count).join(" → ")}\n`);
show();
for (const a of answers) { console.log(`USER: ${a}`); t = await interviewTurn(t.state, a, shells); show(); }
console.log(JSON.stringify(t.state.spec));
