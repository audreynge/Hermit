import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const VID = /^v_[a-f0-9]{24}$/;

// Anonymous per-browser identity; set on first API call.
export async function viewerId(): Promise<string> {
  const jar = await cookies();
  const v = jar.get("hermit_vid")?.value;
  if (v && VID.test(v)) return v;
  const id = `v_${randomBytes(12).toString("hex")}`;
  jar.set("hermit_vid", id, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365, path: "/" });
  return id;
}
