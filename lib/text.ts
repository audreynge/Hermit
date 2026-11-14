// Indefinite article for generated copy ("an office", "a clinic").
export const an = (w: string) => `${/^[aeiou]/i.test(w.trim()) ? "an" : "a"} ${w}`;
