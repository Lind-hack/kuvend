import * as git from "./git.js";
import { readSession, readSettings, saveSession, saveSettings, type Council, type Turn } from "./store.js";

// The council: an optional link to Agentic OS. A take can be put before that account's Roast room
// (several AIs debate, a judge rules); the verdict comes back here and can become the next message.
// Kuvend only ever talks to the dashboard address you saved, with the link code you saved.

export class CouncilError extends Error {}

// https anywhere, or plain http on this machine (a dashboard you run locally).
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new CouncilError("That doesn't look like a web address");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new CouncilError("Use the dashboard's https address");
  return u.origin;
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const c = readSettings().council;
  if (!c) throw new CouncilError("Link Kuvend to your Agentic OS dashboard first");
  const res = await fetch(`${c.url}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${c.code}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => {
    throw new CouncilError(`Couldn't reach the dashboard (${e instanceof Error ? e.message : e})`);
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new CouncilError("The dashboard didn't accept the link code. Make a new one in its Settings, under Kuvend.");
  if (!res.ok) throw new CouncilError(data?.error ?? `The dashboard answered ${res.status}`);
  return data;
}

// Save the link and prove it works: a code that opens nothing fails here, not on the first debate.
export async function link(url: string, code: string) {
  const origin = normalizeUrl(url);
  if (!/^kvd_(owner|u_[0-9a-f]{16})_[\w-]{20,}$/.test(code.trim())) throw new CouncilError("That isn't a Kuvend link code (it starts with kvd_)");
  const previous = readSettings().council;
  saveSettings({ council: { url: origin, code: code.trim() } });
  try {
    await call("/api/kuvend/rooms/R-CHECK00000");
  } catch (e) {
    saveSettings({ council: previous });
    throw e;
  }
  return { url: origin };
}

export function unlink() {
  saveSettings({ council: undefined });
}

export const councilLinked = () => readSettings().council?.url ?? null;

type RoomView = { id: string; status: string; reason?: string; rounds: number; agreement: number | null; verdict: Council["verdict"] };

function need(sessionId: string, turnId: string) {
  const s = readSession(sessionId);
  const t = s?.turns.find((x) => x.id === turnId);
  if (!s || !t) throw new CouncilError("No such take");
  return { s, t };
}

// Put a take before the council: what was asked, what the agent said, and the diff as the evidence.
export async function ask(sessionId: string, turnId: string): Promise<Turn> {
  const { s, t } = need(sessionId, turnId);
  if (t.council && !["done", "cancelled", "refused", "failed"].includes(t.council.status)) throw new CouncilError("The council is already on this take");
  const said = [...t.items].reverse().find((i) => i.kind === "text");
  const diff = t.before && t.after ? await git.fullDiff(s.cwd, t.before, t.after, 24_000) : "";
  const task = `A coding agent (${t.agent === "claude" ? "Claude Code" : "Codex"}) made a change for this request:

"${t.prompt.slice(0, 2000)}"

Debate: is this change right as it stands, and what exactly should happen next? Weigh correctness, risk, and whether it does what was asked.`;
  const context = `## What the agent said\n\n${said?.kind === "text" ? said.text.slice(0, 4000) : "(nothing)"}\n\n## The change\n\n\`\`\`diff\n${diff || "(no file changes)"}\n\`\`\``;
  const r = await call<{ id: string; url: string }>("/api/kuvend/rooms", { body: { task, context } });
  const base = readSettings().council!.url;
  t.council = { roomId: r.id, url: `${base}${r.url}`, status: "queued", rounds: 0, agreement: null, askedAt: new Date().toISOString() };
  saveSession(s);
  return t;
}

// Ask the dashboard where the debate stands and keep it on the take.
export async function refresh(sessionId: string, turnId: string): Promise<Turn> {
  const { s, t } = need(sessionId, turnId);
  if (!t.council) throw new CouncilError("This take hasn't been sent to the council");
  if (t.council.status === "done") return t;
  try {
    const v = await call<RoomView>(`/api/kuvend/rooms/${t.council.roomId}`);
    Object.assign(t.council, { status: v.status, rounds: v.rounds, agreement: v.agreement, verdict: v.verdict ?? null, error: v.reason });
  } catch (e) {
    t.council.error = e instanceof Error ? e.message : String(e);
  }
  saveSession(s);
  return t;
}

// The verdict as the next message to the agent.
export function verdictPrompt(t: Turn): string {
  const v = t.council?.verdict;
  if (!v) throw new CouncilError("No verdict yet");
  return `A council of AIs debated your last change and a judge ruled (${v.outcome}${v.confidence !== null ? `, ${v.confidence}% confident` : ""}).

Decision: ${v.decision ?? v.recommendation}
${v.next_step ? `Next step: ${v.next_step}\n` : ""}${v.actions.length ? `Actions:\n${v.actions.map((a) => `- ${a}`).join("\n")}\n` : ""}${v.dissent.length ? `Dissent worth keeping in mind:\n${v.dissent.map((d) => `- ${d}`).join("\n")}\n` : ""}
Treat this as advice, not proof: check its claims against the code, then do what it recommends if it holds up, and tell me what you changed.`;
}
