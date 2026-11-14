// Hermit never certifies: model text is scrubbed of compliance and guarantee language before anyone sees it.
export const cleanWording = (t: string) =>
  t.replace(/\bADA[- ]compliance\b/gi, "ADA screening").replace(/\bADA[- ]compliant\b/gi, "ADA screening").replace(/\bnon-?compliant\b/gi, "outside screening values")
    .replace(/\bcompliance\b/gi, "screening").replace(/\bcompliant\b/gi, "screened").replace(/\bguarantee(d|s)?\b/gi, "expect").replace(/\bcertif(y|ied|ies)\b/gi, "screen");
