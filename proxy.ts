import { NextResponse, type NextRequest } from "next/server";

const VID = /^v_[a-f0-9]{24}$/;

// Assigns the anonymous viewer cookie on the first request (usually the page load), so
// parallel API calls that follow all see the same id instead of each minting their own.
export function proxy(req: NextRequest) {
  if (VID.test(req.cookies.get("hermit_vid")?.value ?? "")) return NextResponse.next();
  const id = "v_" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  req.cookies.set("hermit_vid", id);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set("hermit_vid", id, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365, path: "/" });
  return res;
}

// /api/design is excluded so multipart uploads skip the proxy body limit; the page load already set the cookie.
export const config = { matcher: ["/((?!_next/static|_next/image|hermit-logo.svg|api/design).*)"] };
