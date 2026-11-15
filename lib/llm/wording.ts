// Hermit never certifies: model text is scrubbed of compliance and guarantee claims before anyone sees it.
// The lease noun ("personal guarantee", "guarantor") is a legal term and must survive.
export const cleanWording = (t: string) =>
  t.replace(/\bADA[- ]compliance\b/gi, "ADA screening").replace(/\bADA[- ]compliant\b/gi, "ADA screening").replace(/\bnon-?compliant\b/gi, "outside screening values")
    .replace(/\bcompliance\b/gi, "screening").replace(/\bcompliant\b/gi, "screened").replace(/\bguaranteed\b/gi, "expected").replace(/\b(we|i|hermit|can|will|to) guarantees?\b/gi, "$1 expect").replace(/\bcertif(y|ied|ies)\b/gi, "screen");
