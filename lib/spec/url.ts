import { RequirementSpec } from "../types";

const toB64Url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

export const encodeSpec = (spec: RequirementSpec) => toB64Url(JSON.stringify(spec));

export function decodeSpec(s: string): RequirementSpec | null {
  try {
    const r = RequirementSpec.safeParse(JSON.parse(fromB64Url(s)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
