import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { briefing, chatFile, claudeDir, codexDir } from "./chats.js";
import * as git from "./git.js";
import { isRunning } from "./sessions.js";
import { home, newId, readPeers, readSession, rememberProject, saveSession, writePeers, type AgentId, type Mode, type Peer, type Session, type Turn } from "./store.js";

// Handing a session to another computer that runs Kuvend: a server that stays on, so the chat keeps going
// when your laptop is off. What travels:
//   - the conversation: Kuvend's turns, and the agent's own chat file, so the agent there resumes the very
//     same chat with its whole context (or, if its CLI can't read that file, gets a briefing of it);
//   - the code: every file as it is right now, uncommitted work included (.gitignored files such as .env
//     and node_modules stay home), as a one-commit git bundle.
// The receiving Kuvend puts the code in a folder of its own (or, for a project it already has, in a safe
// copy on its own branch), so nothing on either side is overwritten. Bringing it back is the same trip.

export type Package = {
  v: 1;
  from: string; // the sending computer's name
  at: string;
  project: { name: string; path: string };
  session: { title: string; agent: AgentId; mode: Mode; model?: string; turns: Turn[] };
  agentId: string | null; // the agent's own chat id
  agentFile: { name: string; text: string } | null;
  bundle: { ref: string; sha: string; data: string } | null; // base64 git bundle
  brief: string;
};

const MAX_FILE = 100 * 1024 * 1024;
const MAX_BUNDLE = 150 * 1024 * 1024;
export const MAX_PACKAGE = 400 * 1024 * 1024;

export async function exportSession(id: string): Promise<Package> {
  const s = readSession(id);
  if (!s) throw new Error("No such session");
  if (isRunning(id)) throw new Error("Wait for the agent to finish first.");
  const agentId = s.agentSessions[s.agent] ?? null;
  let agentFile: Package["agentFile"] = null;
  const file = agentId ? chatFile(s.agent, agentId) : null;
  if (file && fs.statSync(file).size <= MAX_FILE) agentFile = { name: path.basename(file), text: fs.readFileSync(file, "utf8") };

  let bundle: Package["bundle"] = null;
  if (await git.isRepo(s.cwd)) {
    const label = `handoff/${s.id}/${Date.now()}`;
    const sha = await git.snapshot(s.cwd, label);
    const tmp = path.join(os.tmpdir(), `kuvend-${newId("b")}.bundle`);
    try {
      const r = await git.git(s.cwd, ["bundle", "create", tmp, `refs/kuvend/${label}`]);
      if (!r.ok) throw new Error(r.err.trim() || "git bundle failed");
      if (fs.statSync(tmp).size > MAX_BUNDLE) throw new Error("This project is too big to send in one go (over 150 MB without ignored files). Push it to GitHub and open it on the other computer instead.");
      bundle = { ref: `refs/kuvend/${label}`, sha, data: fs.readFileSync(tmp).toString("base64") };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return {
    v: 1,
    from: os.hostname(),
    at: new Date().toISOString(),
    project: { name: path.basename(s.project), path: s.project },
    session: { title: s.title, agent: s.agent, mode: s.mode, model: s.model, turns: s.turns },
    agentId,
    agentFile,
    bundle,
    brief: briefing(s.turns),
  };
}

export const safeName = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 60) || "project";
export const projectsRoot = () => process.env.KUVEND_PROJECTS ?? path.join(home(), "projects");
// Claude Code finds a chat by the folder it runs in: ~/.claude/projects/<folder, non-alphanumerics as ->/.
export const claudeFolder = (cwd: string) => path.join(claudeDir(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));

function check(p: any): Package {
  const ok =
    p?.v === 1 &&
    typeof p.from === "string" &&
    typeof p.project?.name === "string" &&
    typeof p.session?.title === "string" &&
    (p.session.agent === "claude" || p.session.agent === "codex") &&
    Array.isArray(p.session.turns) &&
    (p.agentId === null || /^[0-9a-f-]{36}$/i.test(p.agentId)) &&
    (p.agentFile === null || (typeof p.agentFile?.text === "string" && /^[\w.-]+\.jsonl$/.test(p.agentFile.name))) &&
    (p.bundle === null || (/^refs\/kuvend\/handoff\/s[a-z0-9]+\/\d+$/.test(p.bundle?.ref) && /^[0-9a-f]{40}$/.test(p.bundle.sha) && typeof p.bundle.data === "string"));
  if (!ok) throw new Error("That isn't a Kuvend handoff.");
  return p as Package;
}

function placeAgentFile(pkg: Package, cwd: string) {
  if (!pkg.agentFile || !pkg.agentId) return false;
  if (pkg.session.agent === "claude") {
    const dir = claudeFolder(cwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${pkg.agentId}.jsonl`), pkg.agentFile.text);
    return true;
  }
  const d = pkg.agentFile.name.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T/);
  if (!d || !pkg.agentFile.name.includes(pkg.agentId)) return false;
  // A copy with the same id elsewhere would make Codex pick either: keep just this one.
  const old = chatFile("codex", pkg.agentId);
  if (old) fs.rmSync(old, { force: true });
  const dir = path.join(codexDir(), "sessions", d[1], d[2], d[3]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, pkg.agentFile.name), pkg.agentFile.text);
  return true;
}

export async function fetchBundle(repo: string, b: { ref: string; data: string }) {
  const tmp = path.join(os.tmpdir(), `kuvend-${newId("b")}.bundle`);
  fs.writeFileSync(tmp, Buffer.from(b.data, "base64"));
  try {
    const r = await git.git(repo, ["fetch", "--no-tags", tmp, `+${b.ref}:${b.ref}`]);
    if (!r.ok) throw new Error(r.err.split("\n").filter((l) => l.trim() && !l.startsWith("warning:")).at(-1) ?? "Couldn't read the code that came with this session");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Where the code lands. Coming home (bring back): your own project, in a safe copy on a new branch, so
// your folder is untouched until you merge it. Anything else: a fresh folder of its own, never an
// existing project that happens to share the path.
async function placeCode(pkg: Package, id: string, goingHome: boolean): Promise<{ project: string; cwd: string; branch?: string }> {
  const branch = `kuvend/from-${safeName(pkg.from).toLowerCase()}-${id.slice(-5)}${goingHome ? `-${Date.now().toString(36)}` : ""}`;
  const local = goingHome && path.isAbsolute(pkg.project.path) && fs.existsSync(pkg.project.path) ? path.resolve(pkg.project.path) : null;
  if (local && pkg.bundle && (await git.isRepo(local)) && (await git.hasCommits(local))) {
    const cwd = path.join(home(), "copies", `${id}-${Date.now().toString(36)}`);
    await git.addWorktree(local, cwd, branch);
    await fetchBundle(local, pkg.bundle);
    await git.restore(cwd, pkg.bundle.sha);
    return { project: local, cwd, branch };
  }
  if (local && !pkg.bundle) return { project: local, cwd: local };
  let dir = path.join(projectsRoot(), safeName(pkg.project.name));
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(projectsRoot(), `${safeName(pkg.project.name)}-${n}`);
  fs.mkdirSync(dir, { recursive: true });
  if (pkg.bundle) {
    await git.git(dir, ["init", "-q"]);
    // Files arrive byte for byte: no line-ending conversion from this machine's global git settings.
    await git.git(dir, ["config", "core.autocrlf", "false"]);
    await fetchBundle(dir, pkg.bundle);
    const co = await git.git(dir, ["checkout", "-q", "-b", branch, pkg.bundle.sha]);
    if (!co.ok) throw new Error(co.err.trim() || "Couldn't unpack the code");
  }
  return { project: dir, cwd: dir, branch: pkg.bundle ? branch : undefined };
}

// `into`: bring a session back into this same record (its link stays the same).
export async function importSession(raw: unknown, into?: string): Promise<Session> {
  const pkg = check(raw);
  const id = into ?? newId("s");
  const where = await placeCode(pkg, id, !!into);
  const resumable = placeAgentFile(pkg, where.cwd);
  const now = new Date().toISOString();
  const prev = into ? readSession(into) : null;
  const s: Session = {
    id,
    title: pkg.session.title.slice(0, 80),
    project: where.project,
    cwd: where.cwd,
    branch: where.branch,
    agent: pkg.session.agent,
    mode: pkg.session.mode === "plan" || pkg.session.mode === "full" ? pkg.session.mode : "edit",
    model: typeof pkg.session.model === "string" ? pkg.session.model.slice(0, 80) : undefined,
    agentSessions: resumable && pkg.agentId ? { [pkg.session.agent]: pkg.agentId } : {},
    turns: pkg.session.turns.slice(-300),
    handoff: { from: pkg.from, at: pkg.at, project: pkg.project.path },
    brief: typeof pkg.brief === "string" ? pkg.brief.slice(0, 40_000) : undefined,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  saveSession(s);
  rememberProject(s.project);
  return s;
}

// The other side took the session over: this copy is read-only until it comes back.
export function markSent(id: string, sentTo: NonNullable<Session["sentTo"]>) {
  const s = readSession(id);
  if (!s) throw new Error("No such session");
  s.sentTo = sentTo;
  saveSession(s);
  return s;
}

// ---------- talking to the other computer ----------

export function normalUrl(u: string) {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(u.trim()) ? u.trim() : `http://${u.trim()}`);
  } catch {
    throw new Error("That address doesn't look right. It's the link Kuvend shows on the other computer, like http://my-server.tail1234.ts.net:4777/");
  }
  return `${url.protocol}//${url.host}/`;
}

export async function peerCall<T>(peer: Pick<Peer, "url" | "token">, p: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(new URL(p, peer.url), {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", "x-kuvend-token": peer.token },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10 * 60_000),
    });
  } catch {
    throw new Error("The other computer didn't answer. Check that Kuvend is running there and that both are on Tailscale.");
  }
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(j?.error ?? `The other computer said ${res.status}`);
  return j as T;
}

export async function addPeer(urlIn: string, code: string, role: "server" | "laptop" = "server"): Promise<Peer> {
  const url = normalUrl(urlIn);
  let res: Response;
  try {
    res = await fetch(new URL("api/remote/pair", url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: os.hostname() }), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("Couldn't reach that address. Check that Kuvend runs there with remote access on, and that this computer is on the same Tailscale.");
  }
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || typeof j?.token !== "string") throw new Error(j?.error ?? "Pairing failed");
  const info = await peerCall<{ machine?: string }>({ url, token: j.token }, "api/remote").catch(() => ({}) as { machine?: string });
  const peer: Peer = { id: `p${j.id ?? newId("")}`.slice(0, 16), name: (info.machine ?? new URL(url).hostname.split(".")[0]).slice(0, 40), url, token: j.token, addedAt: new Date().toISOString(), role };
  writePeers([...readPeers().filter((p) => p.url !== url), peer]);
  return peer;
}

export function peer(id: string): Peer {
  const p = readPeers().find((x) => x.id === id);
  if (!p) throw new Error("No such computer. Connect it again.");
  return p;
}

export async function sendTo(sessionId: string, peerId: string) {
  const p = peer(peerId);
  const pkg = await exportSession(sessionId);
  const there = await peerCall<{ id: string; title: string }>(p, "api/handoff/import", { body: pkg });
  const url = `${p.url}#/s/${there.id}`;
  return markSent(sessionId, { peer: p.id, name: p.name, remoteId: there.id, url, at: new Date().toISOString() });
}

export async function bringBack(sessionId: string) {
  const s = readSession(sessionId);
  if (!s?.sentTo) throw new Error("This session wasn't sent anywhere.");
  const p = peer(s.sentTo.peer);
  const pkg = await peerCall<Package>(p, `api/handoff/export/${s.sentTo.remoteId}`);
  await peerCall(p, `api/handoff/sent/${s.sentTo.remoteId}`, { body: { name: os.hostname() } }).catch(() => {});
  // The code comes back into your own project here (a safe copy on its own branch), not a new folder.
  return importSession({ ...pkg, project: { ...pkg.project, path: s.project } }, s.id);
}
