import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Everything Kuvend keeps lives in ~/.kuvend (KUVEND_HOME in tests): sessions, recent projects, the
// access token and the safe copies (git worktrees). Your project folders only ever get what the
// agents write, plus Kuvend's checkpoint refs under refs/kuvend/ in their git.

export const home = () => process.env.KUVEND_HOME ?? path.join(os.homedir(), ".kuvend");
const sessionsDir = () => path.join(home(), "sessions");

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
  before?: string; // checkpoint commit before the turn
  after?: string; // and after it
  undone?: { at: string; redo: string }; // the turn was undone; `redo` is the state it was undone from
  items: Item[];
  files?: FileChange[];
  costUsd?: number;
  council?: Council; // the take was put before an Agentic OS Roast room
};

export type Council = {
  roomId: string;
  url: string; // the room on the dashboard
  status: string; // queued, debating, judging, done, cancelled, refused, failed
  rounds: number;
  agreement: number | null;
  verdict?: { outcome: string; decision: string | null; recommendation: string; next_step: string; actions: string[]; dissent: string[]; confidence: number | null; judge: string } | null;
  error?: string;
  askedAt: string;
};

export type Session = {
  id: string;
  title: string;
  project: string; // the folder the user picked
  cwd: string; // where the agents work: the project, or its safe copy
  branch?: string; // the safe copy's branch
  agent: AgentId;
  mode: Mode;
  model?: string;
  agentSessions: Partial<Record<AgentId, string>>; // each CLI's own conversation id, for resuming
  turns: Turn[];
  createdAt: string;
  updatedAt: string;
  origin?: { agent: AgentId; id: string; imported: number }; // a terminal chat this session continues; its first `imported` turns came from there
  handoff?: { from: string; at: string; project: string }; // handed over from another computer's Kuvend
  sentTo?: { peer: string; name: string; remoteId: string; url: string; at: string }; // handed over to another computer: continue it there
  brief?: string; // the conversation so far in plain text, for an agent that can't resume the original chat
};

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
const ID_RE = /^s[a-z0-9]{8,24}$/;

function writeAtomic(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readSession(id: string): Session | null {
  if (!ID_RE.test(id)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(sessionsDir(), `${id}.json`), "utf8")) as Session;
    // Older files may miss fields: default them instead of trusting the shape.
    return { ...s, turns: Array.isArray(s?.turns) ? s.turns : [], agentSessions: s?.agentSessions ?? {}, mode: s?.mode ?? "edit" };
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  s.updatedAt = new Date().toISOString();
  writeAtomic(path.join(sessionsDir(), `${s.id}.json`), JSON.stringify(s));
}

export function listSessions(): Session[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(sessionsDir()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => readSession(f.slice(0, -5)))
    .filter((s): s is Session => !!s)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteSession(id: string) {
  if (ID_RE.test(id)) fs.rmSync(path.join(sessionsDir(), `${id}.json`), { force: true });
}

// Settings that apply to every session: which model each agent uses (blank = the CLI's own default).
export type Settings = { models: Partial<Record<AgentId, string>>; council?: { url: string; code: string } };
const settingsFile = () => path.join(home(), "settings.json");
const MODEL_RE = /^[\w.:/-]{1,80}$/;
export function readSettings(): Settings {
  try {
    const v = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    const models = Object.fromEntries(Object.entries(v?.models ?? {}).filter(([k, m]) => (k === "claude" || k === "codex") && typeof m === "string" && MODEL_RE.test(m)));
    const c = v?.council;
    const council = c && typeof c.url === "string" && typeof c.code === "string" ? { url: c.url, code: c.code } : undefined;
    return { models, council };
  } catch {
    return { models: {} };
  }
}
export function saveSettings(patch: Partial<Settings>) {
  const current = readSettings();
  // Models merge per agent; an empty value clears that agent's choice back to the CLI default.
  const models = Object.fromEntries(Object.entries({ ...current.models, ...patch.models }).filter(([, m]) => typeof m === "string" && MODEL_RE.test(m)));
  const next: Settings = { ...current, ...patch, models };
  writeAtomic(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

// Recent project folders, newest first.
const projectsFile = () => path.join(home(), "projects.json");
export function recentProjects(): string[] {
  try {
    const v = JSON.parse(fs.readFileSync(projectsFile(), "utf8"));
    return Array.isArray(v) ? v.filter((p) => typeof p === "string" && fs.existsSync(p)) : [];
  } catch {
    return [];
  }
}
export function rememberProject(dir: string) {
  writeAtomic(projectsFile(), JSON.stringify([dir, ...recentProjects().filter((p) => p !== dir)].slice(0, 20)));
}

// Other computers running Kuvend that this one can hand sessions to (a server that stays on).
export type Peer = { id: string; name: string; url: string; token: string; addedAt: string };
const peersFile = () => path.join(home(), "peers.json");
export function readPeers(): Peer[] {
  try {
    const v = JSON.parse(fs.readFileSync(peersFile(), "utf8"));
    return Array.isArray(v) ? v.filter((p) => typeof p?.id === "string" && typeof p?.url === "string" && /^[a-f0-9]{48}$/.test(p?.token ?? "")) : [];
  } catch {
    return [];
  }
}
export function writePeers(list: Peer[]) {
  writeAtomic(peersFile(), JSON.stringify(list, null, 2));
}

// Where the running server listens, so `kuvend handoff` in a terminal can reach it.
export function writeRunning(port: number) {
  writeAtomic(path.join(home(), "running.json"), JSON.stringify({ port, pid: process.pid }));
}
export function readRunning(): { port: number; pid: number } | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(home(), "running.json"), "utf8"));
    return typeof v?.port === "number" ? v : null;
  } catch {
    return null;
  }
}

// One random token per install: the browser tab must present it on every request, so no other site or
// program on this machine can drive your agents through Kuvend's port.
export function accessToken(): string {
  const file = path.join(home(), "token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (/^[a-f0-9]{48}$/.test(t)) return t;
  } catch {
    /* first run */
  }
  const t = crypto.randomBytes(24).toString("hex");
  writeAtomic(file, t);
  return t;
}
