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
};

export type Project = { path: string; name: string; repo: boolean; commits: boolean; branch: string | null; run: string | null; notes: boolean };
export type SessionSummary = { id: string; title: string; project: string; agent: AgentId; branch?: string; turns: number; running: boolean; updatedAt: string };
export type AppState = { agents: Record<AgentId, { installed: boolean; version?: string }>; projects: Project[]; sessions: SessionSummary[] };
export type RunState = { running: boolean; command: string | null; url: string | null; lines: { at: number; text: string; error: boolean }[]; exitCode: number | null; installing: boolean };
export type Warning = { level: "stop" | "check"; title: string; detail: string; file?: string };

const KEY = "kuvend.token";

function readToken(): string {
  const m = location.hash.match(/token=([a-f0-9]{48})/);
  if (m) {
    try {
      localStorage.setItem(KEY, m[1]);
    } catch {
      /* private window: the in-memory copy below still works for this tab */
    }
    history.replaceState(null, "", location.pathname + location.search);
    return m[1];
  }
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export const token = readToken();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
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
  const es = new EventSource(`/api/sessions/${sessionId}/events?token=${token}`);
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
