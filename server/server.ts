import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectAgents, modelSuggestions } from "./agents.js";
import * as git from "./git.js";
import { run } from "./proc.js";
import { detectCommand, errorContext, onRunState, runState, startApp, stopApp } from "./runapp.js";
import * as council from "./council.js";
import * as remote from "./remote.js";
import { checkDiff } from "./safety.js";
import * as sessions from "./sessions.js";
import { accessToken, deleteSession, listSessions, readSession, readSettings, recentProjects, saveSettings, type AgentId, type Mode } from "./store.js";

// Kuvend's local server. It listens on 127.0.0.1, and every request must carry the install's token and
// come from Kuvend's own page: a website you visit can't reach your agents through it. When phone access
// is on (remote.ts), the same page is also served on a private Tailscale address or a Cloudflare tunnel,
// where only a paired phone's key is accepted.

// Built: dist/server → dist/web. From source (npm run dev): server/ → dist/web.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.basename(HERE) === "server" && path.basename(path.dirname(HERE)) === "dist" ? path.resolve(HERE, "../web") : path.resolve(HERE, "../dist/web");
const SHA = /^[0-9a-f]{40}$/;
const AGENTS: AgentId[] = ["claude", "codex"];
const MODES: Mode[] = ["plan", "edit", "full"];

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new HttpError(413, "Too much data");
  }
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new HttpError(400, "Bad JSON");
  }
}

const str = (v: unknown, max = 50_000) => (typeof v === "string" ? v.slice(0, max) : "");
const agentOf = (v: unknown) => (AGENTS.includes(v as AgentId) ? (v as AgentId) : undefined);
const modeOf = (v: unknown) => (MODES.includes(v as Mode) ? (v as Mode) : undefined);

function session(id: string) {
  const s = readSession(id);
  if (!s) throw new HttpError(404, "No such session");
  return s;
}

function folder(v: unknown) {
  const p = str(v, 2000).trim();
  if (!p || !path.isAbsolute(p) || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new HttpError(400, "That folder doesn't exist");
  return path.resolve(p);
}

// The OS's own folder picker, so nobody has to type a path.
async function pickFolder(): Promise<string | null> {
  if (process.platform === "win32") {
    const ps = "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Choose your project folder'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }";
    const r = await run("powershell", ["-NoProfile", "-STA", "-Command", ps], { timeoutMs: 600_000 });
    return r.out.trim() || null;
  }
  if (process.platform === "darwin") {
    const r = await run("osascript", ["-e", 'POSIX path of (choose folder with prompt "Choose your project folder")'], { timeoutMs: 600_000 });
    return r.out.trim() || null;
  }
  const r = await run("zenity", ["--file-selection", "--directory", "--title=Choose your project folder"], { timeoutMs: 600_000 });
  return r.out.trim() || null;
}

const NOTES = ["AGENTS.md", "CLAUDE.md"];
function readNotes(dir: string) {
  for (const f of NOTES) {
    try {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      if (f === "CLAUDE.md" && /^@AGENTS\.md\s*$/m.test(text.trim())) continue;
      return { file: f, text };
    } catch {
      /* next */
    }
  }
  return { file: "AGENTS.md", text: "" };
}

// Project notes are what every agent reads first. Codex reads AGENTS.md; Claude Code reads CLAUDE.md,
// so a missing CLAUDE.md gets a one-line import of AGENTS.md and both agents share one set of notes.
function writeNotes(dir: string, text: string) {
  const current = readNotes(dir);
  fs.writeFileSync(path.join(dir, current.file), text);
  const claude = path.join(dir, "CLAUDE.md");
  if (current.file === "AGENTS.md" && !fs.existsSync(claude)) fs.writeFileSync(claude, "@AGENTS.md\n");
}

async function inspect(dir: string) {
  const repo = await git.isRepo(dir);
  const run = detectCommand(dir);
  return {
    path: dir,
    name: path.basename(dir),
    repo,
    commits: repo ? await git.hasCommits(dir) : false,
    branch: repo ? await git.branch(dir) : null,
    run: run?.label ?? null,
    notes: !!readNotes(dir).text,
  };
}

type Handler = (req: http.IncomingMessage, m: RegExpMatchArray, url: URL) => Promise<unknown>;
// Who sent this request: the laptop's own page (this install's key, on 127.0.0.1) or a paired phone.
const caller = new WeakMap<http.IncomingMessage, "laptop" | "phone">();
const phoneOf = new WeakMap<http.IncomingMessage, string>();
const laptopOnly = (req: http.IncomingMessage) => {
  if (caller.get(req) !== "laptop") throw new HttpError(403, "Only the computer Kuvend runs on can do this.");
};
// The port and request handler the server runs with, so phone access can serve the same page.
const serving: { port: number; handler: http.RequestListener | null } = { port: 0, handler: null };
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, pattern: string, h: Handler) => routes.push([method, new RegExp(`^${pattern}$`), h]);

route("GET", "/api/state", async () => ({
  agents: await detectAgents(),
  projects: await Promise.all(recentProjects().slice(0, 8).map((p) => inspect(p).catch(() => null))).then((x) => x.filter(Boolean)),
  sessions: listSessions()
    .slice(0, 60)
    .map((s) => ({ id: s.id, title: s.title, project: s.project, agent: s.agent, branch: s.branch, turns: s.turns.length, running: sessions.isRunning(s.id), updatedAt: s.updatedAt })),
}));

// Never send the link code back to the page: it only needs to know whether a link exists.
route("GET", "/api/settings", async () => ({ models: readSettings().models, council: council.councilLinked(), suggestions: modelSuggestions() }));

route("POST", "/api/council/link", async (req) => {
  const b = await body(req);
  try {
    return await council.link(str(b.url, 500), str(b.code, 200));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
});
route("DELETE", "/api/council/link", async () => {
  council.unlink();
  return { ok: true };
});

route("POST", "/api/sessions/(s[a-z0-9]+)/turns/(t[a-z0-9]+)/council", async (_r, m) => {
  try {
    return await council.ask(m[1], m[2]);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
});
route("GET", "/api/sessions/(s[a-z0-9]+)/turns/(t[a-z0-9]+)/council", async (_r, m) => council.refresh(m[1], m[2]));
route("POST", "/api/sessions/(s[a-z0-9]+)/turns/(t[a-z0-9]+)/council/apply", async (_r, m) => {
  const t = session(m[1]).turns.find((x) => x.id === m[2]);
  if (!t) throw new HttpError(404, "No such take");
  try {
    return await sessions.send(m[1], { prompt: council.verdictPrompt(t), agent: t.agent });
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
});
route("POST", "/api/settings", async (req) => {
  const b = await body(req);
  const models = b.models && typeof b.models === "object" ? (b.models as Record<string, unknown>) : {};
  const next = saveSettings({ models: Object.fromEntries(Object.entries(models).filter(([k, v]) => AGENTS.includes(k as AgentId) && typeof v === "string").map(([k, v]) => [k, String(v).trim()])) });
  return { models: next.models, council: next.council?.url ?? null };
});

route("POST", "/api/pick-folder", async (req) => {
  // The folder picker opens on the computer, so a phone would wait on a window nobody can see.
  if (caller.get(req) !== "laptop") throw new HttpError(409, "Choose the folder on your computer, or paste its path here.");
  const p = await pickFolder();
  return { path: p, project: p ? await inspect(p) : null };
});

// ---------- continue on your phone ----------
route("GET", "/api/remote", async (req) => ({ ...remote.status(), you: caller.get(req) }));
route("POST", "/api/remote/start", async (req) => {
  laptopOnly(req);
  const want = str((await body(req)).route);
  try {
    return await remote.startRemote(serving.port, serving.handler!, want === "tailscale" || want === "tunnel" ? want : "auto");
  } catch (e) {
    throw new HttpError(e instanceof remote.RemoteError ? 409 : 500, e instanceof Error ? e.message : String(e));
  }
});
route("POST", "/api/remote/stop", async (req) => {
  laptopOnly(req);
  return remote.stopRemote();
});
route("POST", "/api/remote/code", async (req) => {
  laptopOnly(req);
  const s = remote.status();
  if (!s.on || !s.url) throw new HttpError(409, "Turn on phone access first");
  const { code, expiresAt } = remote.newPairingCode();
  return { url: s.url, code, expiresAt };
});
route("DELETE", "/api/remote/devices/(d[0-9a-f]{10})", async (req, m) => {
  laptopOnly(req);
  try {
    remote.removeDevice(m[1]);
  } catch (e) {
    throw new HttpError(404, e instanceof Error ? e.message : String(e));
  }
  return remote.status();
});

route("POST", "/api/project/inspect", async (req) => inspect(folder((await body(req)).path)));

route("POST", "/api/project/git-init", async (req) => {
  const dir = folder((await body(req)).path);
  await git.init(dir);
  return inspect(dir);
});

route("POST", "/api/project/notes", async (req) => {
  const b = await body(req);
  const dir = folder(b.path);
  if (typeof b.text === "string") writeNotes(dir, b.text.slice(0, 200_000));
  return readNotes(dir);
});

route("POST", "/api/sessions", async (req) => {
  const b = await body(req);
  const s = await sessions.createSession({ project: folder(b.project), agent: agentOf(b.agent) ?? "claude", mode: modeOf(b.mode) ?? "edit", model: str(b.model, 100), title: str(b.title, 200), safeCopy: b.safeCopy === true });
  if (str(b.prompt).trim()) await sessions.send(s.id, { prompt: str(b.prompt) });
  return readSession(s.id);
});

route("GET", "/api/sessions/(s[a-z0-9]+)", async (_r, m) => {
  const s = session(m[1]);
  return { session: s, running: sessions.isRunning(s.id), delta: sessions.liveDelta(s.id), run: runState(s.id), project: await inspect(s.cwd).catch(() => null) };
});

route("DELETE", "/api/sessions/(s[a-z0-9]+)", async (_r, m) => {
  session(m[1]);
  sessions.stop(m[1]);
  stopApp(m[1]);
  deleteSession(m[1]);
  return { ok: true };
});

route("POST", "/api/sessions/(s[a-z0-9]+)/send", async (req, m) => {
  const b = await body(req);
  const allow = Array.isArray(b.allow) ? b.allow.filter((x): x is string => typeof x === "string" && x.length < 400) : undefined;
  return sessions.send(m[1], { prompt: str(b.prompt), agent: agentOf(b.agent), mode: modeOf(b.mode), model: typeof b.model === "string" ? str(b.model, 100) : undefined, allow });
});

route("POST", "/api/sessions/(s[a-z0-9]+)/stop", async (_r, m) => {
  sessions.stop(m[1]);
  return { ok: true };
});

route("POST", "/api/sessions/(s[a-z0-9]+)/turns/(t[a-z0-9]+)/(undo|redo|review)", async (_r, m) => {
  if (m[3] === "undo") return sessions.undo(m[1], m[2]);
  if (m[3] === "redo") return sessions.redo(m[1], m[2]);
  return sessions.review(m[1], m[2]);
});

route("GET", "/api/sessions/(s[a-z0-9]+)/changes", async (_r, m) => sessions.sessionChanges(m[1]));

route("GET", "/api/sessions/(s[a-z0-9]+)/diff", async (_r, m, url) => {
  const s = session(m[1]);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const file = url.searchParams.get("file") ?? "";
  if (!SHA.test(from) || !SHA.test(to) || !file || file.startsWith("-")) throw new HttpError(400, "Bad diff request");
  return { diff: await git.fileDiff(s.cwd, from, to, file) };
});

route("POST", "/api/sessions/(s[a-z0-9]+)/run", async (req, m) => {
  const s = session(m[1]);
  const b = await body(req);
  try {
    return startApp(s.id, s.cwd, str(b.command, 500));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
});

route("POST", "/api/sessions/(s[a-z0-9]+)/run/stop", async (_r, m) => {
  stopApp(m[1]);
  return runState(m[1]);
});

// "Fix this": the app's last error goes to the agent as the next message.
route("POST", "/api/sessions/(s[a-z0-9]+)/run/fix", async (_r, m) => {
  const ctx = errorContext(m[1]);
  if (!ctx) throw new HttpError(400, "No error in the app's output yet.");
  const prompt = `My app shows this error when I run \`${runState(m[1]).command}\`:\n\n\`\`\`\n${ctx}\n\`\`\`\n\nFind the cause and fix it. Then tell me in two sentences what was wrong.`;
  return sessions.send(m[1], { prompt });
});

route("POST", "/api/sessions/(s[a-z0-9]+)/save/check", async (_r, m) => {
  const s = session(m[1]);
  if (!(await git.isRepo(s.cwd))) throw new HttpError(400, "This folder isn't using git yet. Turn on undo first.");
  const p = await git.pendingDiff(s.cwd);
  return { files: p.files, warnings: checkDiff(p.diff), branch: await git.branch(s.cwd) };
});

route("POST", "/api/sessions/(s[a-z0-9]+)/save", async (req, m) => {
  const s = session(m[1]);
  const msg = str((await body(req)).message, 2000).trim();
  if (!msg) throw new HttpError(400, "Write what this save is about");
  await git.stageAll(s.cwd);
  await git.commit(s.cwd, msg);
  return { ok: true };
});

route("POST", "/api/sessions/(s[a-z0-9]+)/merge", async (_r, m) => {
  const s = session(m[1]);
  if (!s.branch) throw new HttpError(400, "This session works in the project itself, not a copy.");
  const r = await git.mergeBack(s.project, s.cwd, s.branch, `Kuvend: ${s.title}`);
  if (!r.ok) throw new HttpError(409, r.why ?? "Couldn't bring the copy back");
  return r;
});

// ---------- the server ----------

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon", ".webp": "image/webp", ".webmanifest": "application/manifest+json" };

function serveStatic(res: http.ServerResponse, pathname: string) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  let file = path.resolve(WEB, rel || "index.html");
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("The web app isn't built. Run npm run build.");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
    "Cache-Control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  });
  fs.createReadStream(file).pipe(res);
}

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createServer(port: number) {
  const token = accessToken();
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const handler: http.RequestListener = async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const host = (req.headers.host ?? "").toLowerCase();
    const local = hosts.has(host);
    // A name that resolves here (DNS rebinding) still carries its own Host header: refuse it. The only
    // other names answered are this machine's own phone routes, while phone access is on.
    if (!local && !remote.isRemoteHost(host)) return res.writeHead(421).end();
    if (!url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);

    const origin = req.headers.origin;
    if (origin) {
      const o = origin.replace(/^https?:\/\//, "").toLowerCase();
      if (!hosts.has(o) && !remote.isRemoteHost(o)) return res.writeHead(403).end();
    }

    // Pairing is the one call a phone makes before it has a key: it proves itself with the code.
    if (url.pathname === "/api/remote/pair" && req.method === "POST") {
      try {
        const b = await body(req);
        const out = remote.pair(str(b.code, 64), str(b.name, 80));
        return res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(out));
      } catch (e) {
        return res.writeHead(e instanceof remote.RemoteError ? 403 : 400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    }

    const given = String(req.headers["x-kuvend-token"] ?? url.searchParams.get("token") ?? "");
    // On 127.0.0.1 this install's key works; over a phone route only a paired phone's key does.
    const device = local && same(given, token) ? null : remote.deviceFor(given);
    const who = device ? "phone" : local && same(given, token) ? "laptop" : null;
    if (device) phoneOf.set(req, device);
    if (!who) return res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: local ? "Open Kuvend from the link it printed when it started" : "This phone isn't paired, or was removed. Scan the code on your computer again." }));
    caller.set(req, who);

    // Live updates for one session: turns, streaming text and the app's output.
    const ev = url.pathname.match(/^\/api\/sessions\/(s[a-z0-9]+)\/events$/);
    if (ev && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.flushHeaders(); // open the stream now, not on the first update
      const send = (msg: unknown) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
      const offTurns = sessions.subscribe(ev[1], send);
      const offRun = onRunState(ev[1], (state) => send({ type: "run", state }));
      const poll = setInterval(() => res.write(": ping\n\n"), 15_000);
      const device = phoneOf.get(req);
      const untrack = device ? remote.trackStream(device, () => res.end()) : () => {};
      req.on("close", () => {
        untrack();
        offTurns();
        offRun();
        clearInterval(poll);
      });
      return;
    }

    for (const [method, re, h] of routes) {
      const m = url.pathname.match(re);
      if (!m || method !== req.method) continue;
      try {
        const out = await h(req, m, url);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(out ?? {}));
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
  };
  serving.port = port;
  serving.handler = handler;
  return http.createServer(handler);
}
