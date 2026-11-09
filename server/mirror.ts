import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { briefing, chatFile, codexDir } from "./chats.js";
import * as git from "./git.js";
import { addPeer, claudeFolder, fetchBundle, markSent, peerCall, projectsRoot, safeName } from "./handoff.js";
import * as remote from "./remote.js";
import { isRunning, onTurnEnd } from "./sessions.js";
import { home, listSessions, newId, readPeers, readSession, rememberProject, saveSession, writePeers, type AgentId, type Mode, type Peer, type Session, type Turn } from "./store.js";

// A copy of every laptop chat on your server, so the server can take over when the laptop is off.
//
// After each turn on the laptop, Kuvend sends the server what changed: the turns, the new lines of the
// agent's own chat file, and the code as a git bundle of just the new objects. The server keeps the copy
// under the same session id, read-only. With the laptop off, "Continue here" on the server takes the copy
// over (full context: the agent resumes the same chat file); the laptop learns of it on its next try and
// pauses its own copy until you bring it back.

export type MirrorPackage = {
  v: 1;
  id: string; // the session id, the same on both machines
  from: string;
  at: string;
  project: { name: string; path: string };
  session: { title: string; agent: AgentId; mode: Mode; model?: string; turns: Turn[] };
  agentId: string | null;
  agentFile: { name: string; from: number; text: string } | null; // the bytes from `from` on
  bundle: { ref: string; sha: string; base: string | null; data: string } | null; // base: objects the server already has
  sha: string | null; // the code as it is now (null: not a git project)
  brief: string;
};
export type MirrorState = { sha: string | null; size: number; turns: number; lastEnd: string; at: string };

export class MirrorError extends Error {
  constructor(
    public code: "taken" | "full",
    message: string,
  ) {
    super(message);
  }
}

const MAX_FILE = 100 * 1024 * 1024;

// ---------- the laptop: build what to send ----------

const lastEnd = (s: Session) => s.turns.at(-1)?.endedAt ?? s.turns.at(-1)?.startedAt ?? s.createdAt;

export async function buildMirror(id: string, prev?: MirrorState): Promise<{ pkg: MirrorPackage; state: MirrorState }> {
  const s = readSession(id);
  if (!s) throw new Error("No such session");
  const agentId = s.agentSessions[s.agent] ?? null;

  let agentFile: MirrorPackage["agentFile"] = null;
  let size = 0;
  const file = agentId ? chatFile(s.agent, agentId) : null;
  if (file) {
    const all = fs.readFileSync(file);
    // Only whole lines: a chat file may be mid-write.
    const end = all.lastIndexOf(0x0a) + 1;
    if (end <= MAX_FILE) {
      const from = prev && prev.size <= end ? prev.size : 0;
      size = end;
      agentFile = { name: path.basename(file), from, text: all.subarray(from, end).toString("utf8") };
    }
  }

  let bundle: MirrorPackage["bundle"] = null;
  let sha: string | null = null;
  if (await git.isRepo(s.cwd)) {
    const ref = `refs/kuvend/mirror/${s.id}`;
    sha = await git.snapshot(s.cwd, `mirror/${s.id}`);
    if (sha !== prev?.sha) {
      const base = prev?.sha && (await git.git(s.cwd, ["cat-file", "-e", `${prev.sha}^{commit}`])).ok ? prev.sha : null;
      const tmp = path.join(os.tmpdir(), `kuvend-${newId("m")}.bundle`);
      try {
        const r = await git.git(s.cwd, ["bundle", "create", tmp, ref, ...(base ? [`^${base}`] : [])]);
        if (!r.ok) throw new Error(r.err.trim().split("\n").at(-1) || "git bundle failed");
        bundle = { ref, sha, base, data: fs.readFileSync(tmp).toString("base64") };
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
  }
  const pkg: MirrorPackage = {
    v: 1,
    id: s.id,
    from: os.hostname(),
    at: new Date().toISOString(),
    project: { name: path.basename(s.project), path: s.project },
    session: { title: s.title, agent: s.agent, mode: s.mode, model: s.model, turns: s.turns.slice(-300) },
    agentId,
    agentFile,
    bundle,
    sha,
    brief: briefing(s.turns),
  };
  return { pkg, state: { sha, size, turns: s.turns.length, lastEnd: lastEnd(s), at: pkg.at } };
}

// ---------- the server: keep the copy ----------

function check(p: any): MirrorPackage {
  const ok =
    p?.v === 1 &&
    /^s[a-z0-9]{8,24}$/.test(p.id) &&
    typeof p.from === "string" &&
    typeof p.project?.name === "string" &&
    typeof p.session?.title === "string" &&
    (p.session.agent === "claude" || p.session.agent === "codex") &&
    Array.isArray(p.session.turns) &&
    (p.agentId === null || /^[0-9a-f-]{36}$/i.test(p.agentId)) &&
    (p.agentFile === null || (typeof p.agentFile?.text === "string" && Number.isInteger(p.agentFile.from) && p.agentFile.from >= 0 && /^[\w.-]+\.jsonl$/.test(p.agentFile.name))) &&
    (p.bundle === null || (p.bundle?.ref === `refs/kuvend/mirror/${p.id}` && /^[0-9a-f]{40}$/.test(p.bundle.sha) && (p.bundle.base === null || /^[0-9a-f]{40}$/.test(p.bundle.base)) && typeof p.bundle.data === "string")) &&
    (p.sha === null || /^[0-9a-f]{40}$/.test(p.sha));
  if (!ok) throw new Error("That isn't a Kuvend copy.");
  return p as MirrorPackage;
}

function agentPath(pkg: MirrorPackage, cwd: string): string | null {
  if (!pkg.agentFile || !pkg.agentId) return null;
  if (pkg.session.agent === "claude") return path.join(claudeFolder(cwd), `${pkg.agentId}.jsonl`);
  const d = pkg.agentFile.name.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T/);
  if (!d || !pkg.agentFile.name.includes(pkg.agentId)) return null;
  return path.join(codexDir(), "sessions", d[1], d[2], d[3], pkg.agentFile.name);
}

export async function applyMirror(raw: unknown): Promise<Session> {
  const pkg = check(raw);
  const prev = readSession(pkg.id);
  if (prev?.mirrorOf?.takenAt && !prev.sentTo) throw new MirrorError("taken", "This chat was taken over here.");
  if (prev && !prev.mirrorOf && !prev.sentTo) throw new MirrorError("taken", "A different chat has this id here.");

  // Where the copy lives: its folder from last time, or a new one.
  let cwd = prev?.cwd && fs.existsSync(prev.cwd) ? prev.cwd : null;
  if (!cwd) {
    if (pkg.bundle?.base || (pkg.agentFile && pkg.agentFile.from > 0)) throw new MirrorError("full", "Send the whole chat: this server has no copy yet.");
    let dir = path.join(projectsRoot(), safeName(pkg.project.name));
    for (let n = 2; fs.existsSync(dir); n++) dir = path.join(projectsRoot(), `${safeName(pkg.project.name)}-${n}`);
    fs.mkdirSync(dir, { recursive: true });
    cwd = dir;
  }
  let branch = prev?.branch;
  if (pkg.bundle) {
    if (!fs.existsSync(path.join(cwd, ".git"))) {
      await git.git(cwd, ["init", "-q"]);
      await git.git(cwd, ["config", "core.autocrlf", "false"]);
    }
    try {
      await fetchBundle(cwd, pkg.bundle);
    } catch {
      throw new MirrorError("full", "This server is missing part of the code. Send the whole chat.");
    }
    if (!(await git.hasCommits(cwd))) {
      branch = `kuvend/from-${safeName(pkg.from).toLowerCase()}`;
      const co = await git.git(cwd, ["checkout", "-q", "-b", branch, pkg.bundle.sha]);
      if (!co.ok) throw new Error(co.err.trim() || "Couldn't unpack the code");
    } else {
      await git.restore(cwd, pkg.bundle.sha);
    }
  }

  // The agent's chat file: append the new lines, or write it whole.
  const target = agentPath(pkg, cwd);
  if (target && pkg.agentFile) {
    const have = fs.existsSync(target) ? fs.statSync(target).size : 0;
    if (pkg.agentFile.from > 0 && have !== pkg.agentFile.from) throw new MirrorError("full", "The chat file here is out of step. Send it whole.");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (pkg.agentFile.from === 0) fs.writeFileSync(target, pkg.agentFile.text);
    else fs.appendFileSync(target, pkg.agentFile.text);
  }

  const now = new Date().toISOString();
  const s: Session = {
    id: pkg.id,
    title: pkg.session.title.slice(0, 80),
    project: cwd,
    cwd,
    branch,
    agent: pkg.session.agent,
    mode: pkg.session.mode === "plan" || pkg.session.mode === "full" ? pkg.session.mode : "edit",
    model: typeof pkg.session.model === "string" ? pkg.session.model.slice(0, 80) : undefined,
    agentSessions: target && pkg.agentId ? { [pkg.session.agent]: pkg.agentId } : {},
    turns: pkg.session.turns.slice(-300),
    brief: pkg.brief.slice(0, 40_000),
    mirrorOf: { name: pkg.from.slice(0, 60), at: now },
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  saveSession(s);
  rememberProject(cwd);
  return s;
}

// With the laptop off: the copy becomes the chat, here.
export function takeOver(id: string): Session {
  const s = readSession(id);
  if (!s?.mirrorOf) throw new Error("This chat isn't a copy.");
  if (!s.mirrorOf.takenAt) s.mirrorOf.takenAt = new Date().toISOString();
  delete s.sentTo;
  saveSession(s);
  return s;
}

// The laptop asks which of its chats moved here.
export const takenIds = () => listSessions().filter((s) => s.mirrorOf?.takenAt && !s.sentTo).map((s) => s.id);

// ---------- the laptop: keep the server's copies current ----------

const stateFile = () => path.join(home(), "mirrors.json");
type States = Record<string, Record<string, MirrorState>>; // session -> peer -> state
function readStates(): States {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as States;
  } catch {
    return {};
  }
}
function writeState(session: string, peer: string, st: MirrorState | null) {
  const all = readStates();
  all[session] = { ...(all[session] ?? {}) };
  if (st) all[session][peer] = st;
  else delete all[session][peer];
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(all));
}

const servers = () => readPeers().filter((p) => (p.role ?? "server") === "server");

export async function pushTo(peer: Peer, id: string, full = false): Promise<"sent" | "moved" | "skipped"> {
  const s = readSession(id);
  if (!s || s.sentTo || s.mirrorOf || isRunning(id)) return "skipped";
  const prev = full ? undefined : readStates()[id]?.[peer.id];
  const { pkg, state } = await buildMirror(id, prev);
  try {
    await peerCall(peer, "api/handoff/mirror", { body: pkg });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/send (it|the whole)/i.test(msg) && !full) return pushTo(peer, id, true);
    if (/taken over here/i.test(msg)) {
      markSent(id, { peer: peer.id, name: peer.name, remoteId: id, url: `${peer.url}#/s/${id}`, at: new Date().toISOString() });
      return "moved";
    }
    throw e;
  }
  writeState(id, peer.id, state);
  return "sent";
}

// Chats that changed since their last copy, newest first (recent ones only: a fortnight).
function stale(peer: Peer): string[] {
  const states = readStates();
  const since = Date.now() - 14 * 86_400_000;
  return listSessions()
    .filter((s) => !s.sentTo && !s.mirrorOf && Date.parse(s.updatedAt) > since && s.turns.length > 0)
    .filter((s) => {
      const st = states[s.id]?.[peer.id];
      return !st || st.turns !== s.turns.length || st.lastEnd !== lastEnd(s);
    })
    .map((s) => s.id);
}

const queue = new Set<string>();
let busy = false;
let serving: { port: number; handler: http.RequestListener } | null = null;

async function drain() {
  if (busy) return;
  busy = true;
  try {
    for (const peer of servers()) {
      // Chats taken over there (the laptop was off): pause them here.
      const taken = await peerCall<{ ids: string[] }>(peer, "api/handoff/taken").catch(() => null);
      if (!taken) continue; // the server is unreachable right now: try again later
      for (const id of taken.ids) {
        const s = readSession(id);
        if (s && !s.sentTo && !s.mirrorOf) markSent(id, { peer: peer.id, name: peer.name, remoteId: id, url: `${peer.url}#/s/${id}`, at: new Date().toISOString() });
      }
      await linkBack(peer);
      const ids = [...new Set([...queue, ...stale(peer)])];
      queue.clear();
      for (const id of ids) await pushTo(peer, id).catch(() => queue.add(id));
    }
  } finally {
    busy = false;
  }
}

// Let the server reach this laptop too (its app then shows the laptop's live chats): turn on remote
// access here (Tailscale only, so nothing becomes public) and pair the server with a fresh code.
async function linkBack(peer: Peer) {
  if (!serving) return;
  let st = remote.status();
  if (!st.on) st = await remote.startRemote(serving.port, serving.handler, "tailscale").catch(() => st);
  if (!st.on || !st.url || st.route !== "tailscale") return;
  // Linked already, at this address: nothing to do. A new address (Kuvend came up on another port): link again.
  if (peer.linked === st.url) return;
  const url = st.url;
  const { code } = remote.newPairingCode();
  await peerCall(peer, "api/peers/reverse", { body: { url, code } })
    .then(() => writePeers(readPeers().map((p) => (p.id === peer.id ? { ...p, linked: url } : p))))
    .catch(() => {});
}

// Started by the CLI on a laptop: copy after every turn, and catch up once a minute.
export function startMirroring(port: number, handler: http.RequestListener) {
  serving = { port, handler };
  let timer: NodeJS.Timeout | null = null;
  onTurnEnd((id) => {
    queue.add(id);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void drain(), 3000);
  });
  setTimeout(() => void drain(), 5000);
  setInterval(() => void drain(), 60_000).unref();
}

// The server pairs back with its laptop.
// The server pairs back with its laptop; a new address replaces the old one.
export async function linkFromLaptop(url: string, code: string) {
  const p = await addPeer(url, code, "laptop");
  writePeers(readPeers().filter((x) => x.id === p.id || !(x.role === "laptop" && x.name === p.name)));
  return p;
}
