// Indefinite article for generated copy ("an office", "a clinic").
export const an = (w: string) => `${/^[aeiou]/i.test(w.trim()) ? "an" : "a"} ${w}`;

// Gmail's compose window, prefilled. Hermit never sends: the user reviews and presses send in Gmail.
const enc = encodeURIComponent;
export const gmailUrl = (to: string, subject: string, body: string) => `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
// Links can't attach files, so the packet goes in as a link (browser only: uses the page's origin).
export const withPacketLink = (body: string, runId?: string, shellId?: string) =>
  runId && shellId ? `${body}\n\nTenant packet (PDF): ${window.location.origin}/packet/${runId}/${shellId}?print=1` : body;
export const openGmail = (to: string, subject: string, body: string) => window.open(gmailUrl(to, subject, body), "_blank", "noopener");
