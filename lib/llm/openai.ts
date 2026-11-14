import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "../db";

// OpenAI as a planner/chat provider. Credentials: OPENAI_API_KEY, or "Sign in with ChatGPT" (OAuth + PKCE, plan usage)
// per developers.openai.com/siwc/token-sharing-open-source. That flow is for locally hosted apps: loopback callback only,
// and the signed-in plan is used only for requests that arrive on this machine (never for tunnel visitors).

const AUTH = "https://auth.openai.com";
const AUTHORIZE = `${AUTH}/api/accounts/authorize`;
const TOKEN = `${AUTH}/api/accounts/oauth/token`;
const REVOKE = `${AUTH}/api/accounts/oauth/revoke`;
const API = "https://api.openai.com/v1";
const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const CALLBACK_PATH = "/api/auth/openai/callback";

type Tokens = { access_token: string; refresh_token: string; id_token: string; expires_at: number };
type Row = { host_id: string; client_id: string | null; tokens: Tokens | null; email: string | null; model: string | null; pending: Pending | null };
type Pending = { state: string; nonce: string; verifier: string; redirect: string; returnTo: string; at: number };

const b64url = (b: Buffer) => b.toString("base64url");
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString() || "{}");

function table() {
  db().exec("CREATE TABLE IF NOT EXISTS openai_auth (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)");
}
function load(): Row {
  table();
  const r = db().prepare("SELECT json FROM openai_auth WHERE id = 1").get() as { json: string } | undefined;
  if (r) return JSON.parse(r.json);
  // ext_agent_host_id: opaque, stable per host, created once and reused for every sign-in.
  const row: Row = { host_id: `urn:uuid:${randomUUID()}`, client_id: null, tokens: null, email: null, model: null, pending: null };
  save(row);
  return row;
}
function save(row: Row) {
  table();
  db().prepare("INSERT OR REPLACE INTO openai_auth (id, json) VALUES (1, ?)").run(JSON.stringify(row));
}

// Loopback = made on this machine, not through a tunnel. Next fills x-forwarded-* itself from the socket and rewrites
// req.url to localhost, so trust the Host header plus every forwarded address being local (ngrok keeps its own Host and client IP).
const LOCAL = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost)$/;
const origin = (req: Request) => new URL(`http://${req.headers.get("host") ?? new URL(req.url).host}`);
export function isLoopback(req: Request) {
  const h = req.headers;
  const hosts = [origin(req).hostname.replace(/^\[|\]$/g, ""), ...[h.get("x-forwarded-host")].filter(Boolean).map((x) => new URL(`http://${x}`).hostname.replace(/^\[|\]$/g, ""))];
  const ips = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hosts.every((x) => LOCAL.test(x)) && ips.every((x) => LOCAL.test(x)) && !h.get("x-real-ip") && !h.get("forwarded");
}

export function authorizeUrl(req: Request, returnTo = "/") {
  const row = load();
  const port = origin(req).port || "80";
  const p: Pending = {
    state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)),
    redirect: `http://127.0.0.1:${port}${CALLBACK_PATH}`, returnTo: new URL(returnTo, origin(req)).toString(), at: Date.now(),
  };
  save({ ...row, pending: p });
  const q = new URLSearchParams({
    response_type: "code", redirect_uri: p.redirect, scope: SCOPE, resource: API, state: p.state, nonce: p.nonce,
    code_challenge_method: "S256", code_challenge: b64url(createHash("sha256").update(p.verifier).digest()),
    ext_agent_host_id: row.host_id,
  });
  if (row.client_id) {
    q.set("client_id", row.client_id);
    if (row.tokens?.id_token) q.set("id_token_hint", row.tokens.id_token);
  } else {
    q.set("client_id", "dynamic_agent_client");
    q.set("agent_name_hint", "Hermit");
  }
  return `${AUTHORIZE}?${q}`;
}

async function tokenCall(body: Record<string, string>) {
  const res = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`token endpoint ${res.status}: ${j.error_description ?? j.error ?? "no access token"}`);
  return j as { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number };
}

// Callback: validate state, exchange the code (PKCE, no secret), check the ID token, store per-registration credentials.
export async function completeSignIn(params: URLSearchParams): Promise<string> {
  const row = load();
  const p = row.pending;
  if (!p || params.get("state") !== p.state || Date.now() - p.at > 10 * 60_000) throw new Error("Sign-in expired or did not start here. Try again.");
  if (params.get("error")) throw new Error(params.get("error_description") ?? params.get("error")!);
  const code = params.get("code");
  const clientId = params.get("client_id") ?? row.client_id;
  if (!code || !clientId || clientId === "dynamic_agent_client") throw new Error("OpenAI did not return a sign-in code.");
  const t = await tokenCall({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: p.verifier, redirect_uri: p.redirect, resource: API });
  const id = claims(t.id_token ?? "");
  if (id.iss !== AUTH || id.nonce !== p.nonce || ![id.aud].flat().includes(clientId) || (id.exp ?? 0) * 1000 < Date.now())
    throw new Error("OpenAI sign-in could not be verified.");
  if (!t.refresh_token) throw new Error("OpenAI did not grant offline access.");
  const tokens: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token, id_token: t.id_token!, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000 };
  save({ ...row, client_id: clientId, tokens, email: id.email ?? null, model: await pickModel(t.access_token), pending: null });
  return p.returnTo;
}

async function pickModel(token: string): Promise<string | null> {
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  try {
    const res = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${token}` } });
    const ids: string[] = ((await res.json()).data ?? []).filter((m: { visibility?: string }) => m.visibility === "list").map((m: { id: string }) => m.id);
    return ids[0] ?? null;
  } catch {
    return null;
  }
}

let refreshing: Promise<Tokens> | null = null;
// Refresh near expiry; serialized so concurrent requests don't spend the same single-use refresh token twice.
async function accessToken(): Promise<string | null> {
  const row = load();
  if (!row.tokens || !row.client_id) return null;
  if (row.tokens.expires_at - Date.now() > 5 * 60_000) return row.tokens.access_token;
  refreshing ??= (async () => {
    const t = await tokenCall({ grant_type: "refresh_token", client_id: row.client_id!, refresh_token: row.tokens!.refresh_token });
    const tokens: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token ?? row.tokens!.refresh_token, id_token: t.id_token ?? row.tokens!.id_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000 };
    save({ ...load(), tokens });
    return tokens;
  })().finally(() => (refreshing = null));
  try {
    return (await refreshing).access_token;
  } catch {
    return null; // expired session: the UI shows "Connect ChatGPT" again
  }
}

export async function signOut(): Promise<{ revoked: boolean }> {
  const row = load();
  let revoked = !row.tokens;
  if (row.tokens && row.client_id) {
    for (let i = 0; i < 3 && !revoked; i++) {
      const res = await fetch(REVOKE, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: row.tokens.refresh_token, token_type_hint: "refresh_token", client_id: row.client_id }) }).catch(() => null);
      revoked = res?.status === 200;
      if (res && res.status < 500) break;
    }
  }
  // Keep host id + client id for the next sign-in; drop the tokens either way.
  save({ ...row, tokens: null, email: null });
  return { revoked };
}

export function status(req: Request) {
  const row = load();
  return { connected: !!row.tokens, email: row.email, model: row.model, apiKey: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY, canSignIn: isLoopback(req) };
}

// ---- Responses API (streaming, store:false — required for plan usage; fine for API keys too) ----

export type ResponseItem = { type: string; [k: string]: unknown };
export type OpenAIClient = { model: string; respond(body: Record<string, unknown>): Promise<{ output: ResponseItem[] }> };

export async function openaiClient(local: boolean): Promise<OpenAIClient | null> {
  const key = process.env.OPENAI_API_KEY;
  const token = key ?? (local ? await accessToken() : null);
  if (!token) return null;
  const model = process.env.OPENAI_MODEL ?? (key ? null : load().model) ?? (await pickModel(token));
  if (!model) return null;
  return { model, respond: (body) => respond(token, { model, ...body }) };
}

async function respond(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true, store: false, include: ["reasoning.encrypted_content"] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok || !res.body) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return readStream(res.body);
}

// Only response.completed counts as success; failed/incomplete/interrupted streams are errors.
export async function readStream(body: ReadableStream<Uint8Array>): Promise<{ output: ResponseItem[] }> {
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      const e = JSON.parse(data);
      if (e.type === "response.completed") return e.response;
      if (e.type === "response.failed" || e.type === "response.incomplete" || e.type === "error")
        throw new Error(`OpenAI ${e.type}: ${e.response?.error?.code ?? e.response?.incomplete_details?.reason ?? e.code ?? e.message ?? "unknown"}`);
    }
  }
  throw new Error("OpenAI stream ended before response.completed");
}

export const outputText = (out: ResponseItem[]) =>
  out.filter((o) => o.type === "message").flatMap((o) => (o.content as { type: string; text?: string }[]) ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("").trim();
