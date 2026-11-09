// The browser side of Kuvend's local API. The token arrives once in the URL fragment (#token=…), is kept
// in this browser, and goes on every request; it never appears in server logs or referrers.

export type AgentId = "claude" | "codex";
export type Mode = "plan" | "edit" | "full";

export type Item =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; detail: string; ok?: boolean; output?: string }
  | { kind: "error"; text: string }
  | { kind: "denied"; tools: { name: string; detail: string; allow: string }[] };

export type FileChange = { path: string; status: string; added: number; removed: number };

export type Turn = {
  id: string;
  kind: "chat" | "review";
  agent: AgentId;
  mode: Mode;
  prompt: string;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  endedAt?: string;
  before?: string;
  after?: string;
  undone?: { at: string; redo: string };
  items: Item[];
  files?: FileChange[];
  costUsd?: number;
  council?: Council;
};

export type Council = {
  roomId: string;
  url: string;
  status: string;
  rounds: number;
  agreement: number | null;
  verdict?: { outcome: string; decision: string | null; recommendation: string; next_step: string; actions: string[]; dissent: string[]; confidence: number | null; judge: string } | null;
  error?: string;
  askedAt: string;
};

export type Session = {
  id: string;
  title: string;
  project: string;
  cwd: string;
  branch?: string;
  agent: AgentId;
  mode: Mode;
  model?: string;
  turns: Turn[];
  createdAt: string;
  updatedAt: string;
  origin?: { agent: AgentId; id: string; imported: number };
  handoff?: { from: string; at: string; project: string };
  sentTo?: { peer: string; name: string; remoteId: string; url: string; at: string };
  mirrorOf?: MirrorOf;
};
// A copy this server keeps of a chat on another computer (your laptop); taken over when that one is off.
export type MirrorOf = { name: string; at: string; takenAt?: string };

export type Project = { path: string; name: string; repo: boolean; commits: boolean; branch: string | null; run: string | null; notes: boolean };
export type SessionSummary = { id: string; title: string; project: string; agent: AgentId; branch?: string; turns: number; running: boolean; updatedAt: string; from: string | null; sentTo: { name: string; url: string } | null; mirrorOf?: MirrorOf | null };
export type AppState = { agents: Record<AgentId, { installed: boolean; version?: string }>; projects: Project[]; sessions: SessionSummary[]; machine: string };
// A Claude Code or Codex chat from the terminal (or their apps) on this computer.
export type Chat = { agent: AgentId; id: string; cwd: string; title: string; last: string; updatedAt: string; size: number; here: boolean; session: string | null };
// Another computer running Kuvend, usually a server that stays on.
export type Peer = { id: string; name: string; url: string; addedAt: string; role: "server" | "laptop" };

// While a chat on another computer is open (the laptop's, seen from the server's app), its calls go
// through this machine: /api/peers/<id>/proxy/...
let remoteBase = "";
export const setRemote = (peer: string | null) => void (remoteBase = peer ? `/api/peers/${peer}/proxy` : "");
const routed = (path: string) => (remoteBase && /^\/api\/(sessions|settings|project)(\/|$|\?)/.test(path) ? `${remoteBase}${path.slice(4)}` : path);
export type RunState = { running: boolean; command: string | null; url: string | null; lines: { at: number; text: string; error: boolean }[]; exitCode: number | null; installing: boolean };
export type Warning = { level: "stop" | "check"; title: string; detail: string; file?: string };

const KEY = "kuvend.token";

// Opened on a phone (over Tailscale or a tunnel) rather than on the computer Kuvend runs on.
export const onPhone = !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);

// Opened from the home screen as an app. On an iPhone it keeps storage apart from Safari, so it pairs
// on its own, by typing the short code.
export const standalone = typeof window !== "undefined" && (matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

// A phone that scanned the computer's code opens #pair=<code>&s=<session>.
export function pairFromHash(): { code: string; session: string | null } | null {
  const m = location.hash.match(/^#pair=([a-f0-9]{32})(?:&s=(s[a-z0-9]+))?$/);
  return m ? { code: m[1], session: m[2] ?? null } : null;
}

function readToken(): string {
  const m = location.hash.match(/token=([a-f0-9]{48})/);
  if (m) {
    try {
      localStorage.setItem(KEY, m[1]);
    } catch {
      /* private window: the in-memory copy below still works for this tab */
    }
    history.replaceState(null, "", location.pathname + location.search + location.hash.replace(/^#?token=[a-f0-9]{48}&?/, "#").replace(/^#$/, ""));
    return m[1];
  }
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export let token = readToken();

// Trade the one-time code for this phone's own key, and keep it in this browser.
export async function pairPhone(code: string): Promise<void> {
  const ua = navigator.userAgent;
  const name = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : "Phone";
  const res = await fetch("/api/remote/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name }) }).catch(() => null);
  if (!res) throw new ApiError(0, "Can't reach your computer. Is Kuvend still running there, with phone access on?");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !/^[a-f0-9]{48}$/.test(data?.token ?? "")) throw new ApiError(res.status, data?.error ?? "Pairing didn't work. Show a new code on your computer.");
  token = data.token;
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* private window: this tab still works */
  }
}

export type RemoteDevice = { id: string; name: string; createdAt: string; lastSeenAt: string | null };
export type RemoteStatus = { on: boolean; route: "tailscale" | "tunnel" | null; url: string | null; pairing: { expiresAt: string } | null; devices: RemoteDevice[]; you?: "laptop" | "phone"; kept?: boolean; machine?: string };
export type PairCode = { url: string; code: string; short: string; expiresAt: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(routed(path), {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { "x-kuvend-token": token, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch(() => null);
  if (!res) throw new ApiError(0, "Kuvend isn't running. Start it again from your terminal.");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Something went wrong (${res.status})`);
  return data as T;
}

export type LiveMessage = { type: "turn"; turn: Turn; ended?: boolean } | { type: "delta"; turn: string; text: string } | { type: "run"; state: RunState };

export function events(sessionId: string, onMessage: (m: LiveMessage) => void): () => void {
  const es = new EventSource(routed(`/api/sessions/${sessionId}/events?token=${token}`));
  es.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* ignore a malformed frame */
    }
  };
  return () => es.close();
}

export const AGENT_NAME: Record<AgentId, string> = { claude: "Claude Code", codex: "Codex" };
export const MODE_INFO: Record<Mode, { label: string; hint: string }> = {
  plan: { label: "Plan", hint: "Looks and plans. Changes nothing." },
  edit: { label: "Edit", hint: "Changes files. Asks before running commands." },
  full: { label: "Full", hint: "Changes files and runs any command." },
};
