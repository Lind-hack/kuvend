import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// The server keeps a copy of every laptop chat, sending only what changed; with the laptop off it takes
// over from that copy; while the laptop is on, the server's app reaches the laptop's live chats through it.

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const env = (vars: Record<string, string>) => Object.assign(process.env, vars);
const LAPTOP = { KUVEND_HOME: tmp("kv-laptop-"), CLAUDE_CONFIG_DIR: tmp("kv-laptop-claude-"), CODEX_HOME: tmp("kv-laptop-codex-") };
const SERVER = { KUVEND_HOME: tmp("kv-server-"), CLAUDE_CONFIG_DIR: tmp("kv-server-claude-"), CODEX_HOME: tmp("kv-server-codex-"), KUVEND_PROJECTS: tmp("kv-server-projects-") };
env(LAPTOP);

const mirror = await import("./mirror.js");
const sessions = await import("./sessions.js");
const git = await import("./git.js");
const store = await import("./store.js");
const { createServer } = await import("./server.js");
const remote = await import("./remote.js");
const autostart = await import("./autostart.js");

async function laptopChat() {
  const dir = tmp("kv-proj-");
  fs.writeFileSync(path.join(dir, "app.js"), "v1\n");
  await git.init(dir);
  await git.stageAll(dir);
  await git.commit(dir, "first");
  const s = await sessions.createSession({ project: dir, agent: "claude", mode: "edit", title: "Shop page" });
  // The agent's own chat file, as Claude Code keeps it.
  const id = "22222222-aaaa-4bbb-8ccc-000000000001";
  const folder = path.join(LAPTOP.CLAUDE_CONFIG_DIR, "projects", dir.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${id}.jsonl`), JSON.stringify({ type: "user", cwd: dir, entrypoint: "sdk-cli", message: { content: "Add a shop page" } }) + "\n");
  const rec = store.readSession(s.id)!;
  rec.agentSessions.claude = id;
  rec.turns.push({ id: "t1", kind: "chat", agent: "claude", mode: "edit", prompt: "Add a shop page", status: "done", startedAt: new Date().toISOString(), items: [{ kind: "text", text: "Added." }] });
  store.saveSession(rec);
  return { s: rec, dir, folder, id };
}

test("the server keeps a copy of a laptop chat, and later trips send only what changed", async () => {
  env(LAPTOP);
  const { s, dir, folder, id } = await laptopChat();
  const first = await mirror.buildMirror(s.id);
  assert.ok(first.pkg.bundle && first.pkg.bundle.base === null, "the first copy carries the whole tree");

  env(SERVER);
  await mirror.applyMirror(JSON.parse(JSON.stringify(first.pkg)));
  const copy = store.readSession(s.id)!;
  assert.equal(copy.mirrorOf?.name, os.hostname());
  assert.equal(fs.readFileSync(path.join(copy.cwd, "app.js"), "utf8"), "v1\n");
  assert.equal(copy.agentSessions.claude, id);

  // On the laptop: another turn, a changed file, a longer chat file.
  env(LAPTOP);
  fs.writeFileSync(path.join(dir, "app.js"), "v2\n");
  fs.appendFileSync(path.join(folder, `${id}.jsonl`), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "v2 done" }] } }) + "\n");
  const rec = store.readSession(s.id)!;
  rec.turns.push({ id: "t2", kind: "chat", agent: "claude", mode: "edit", prompt: "Make it v2", status: "done", startedAt: new Date().toISOString(), items: [] });
  store.saveSession(rec);
  const second = await mirror.buildMirror(s.id, first.state);
  assert.equal(second.pkg.bundle?.base, first.state.sha, "only the change travels");
  assert.ok(second.pkg.agentFile && second.pkg.agentFile.from > 0 && !second.pkg.agentFile.text.includes("Add a shop page"), "only the new lines of the chat file travel");

  env(SERVER);
  await mirror.applyMirror(JSON.parse(JSON.stringify(second.pkg)));
  const after = store.readSession(s.id)!;
  assert.equal(after.turns.length, 2);
  assert.equal(fs.readFileSync(path.join(after.cwd, "app.js"), "utf8"), "v2\n");
  const chatFile = path.join(SERVER.CLAUDE_CONFIG_DIR, "projects", after.cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`);
  assert.equal(fs.readFileSync(chatFile, "utf8").trim().split("\n").length, 2, "the chat file there is the whole chat");

  // A copy that can't take a partial trip (fresh server) asks for everything.
  env({ ...SERVER, KUVEND_HOME: tmp("kv-server2-"), KUVEND_PROJECTS: tmp("kv-server2-p-") });
  await assert.rejects(mirror.applyMirror(JSON.parse(JSON.stringify(second.pkg))), (e: Error) => e instanceof mirror.MirrorError && e.code === "full");
  env(SERVER);
});

test("with the laptop off, the server takes over its copy; the laptop then learns the chat moved", async () => {
  env(LAPTOP);
  const { s } = await laptopChat();
  const built = await mirror.buildMirror(s.id);
  env(SERVER);
  await mirror.applyMirror(JSON.parse(JSON.stringify(built.pkg)));
  await assert.rejects(sessions.send(s.id, { prompt: "hi" }), /copy of a chat on/, "a copy can't be typed to until it's taken over");
  mirror.takeOver(s.id);
  assert.ok(store.readSession(s.id)!.mirrorOf?.takenAt);
  assert.ok(mirror.takenIds().includes(s.id), "the laptop can ask which of its chats moved");
  await assert.rejects(mirror.applyMirror(JSON.parse(JSON.stringify(built.pkg))), (e: Error) => e instanceof mirror.MirrorError && e.code === "taken", "the laptop's next copy is refused: the chat lives here now");
  env(LAPTOP);
});

test("the server's app reaches the laptop's live chats through the server, and only chat routes", async () => {
  env(SERVER);
  const seen: string[] = [];
  const upstream = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers["x-kuvend-token"]}`);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const up = (upstream.address() as { port: number }).port;
  store.writePeers([{ id: "plaptop1", name: "laptop", url: `http://127.0.0.1:${up}/`, token: "c".repeat(48), addedAt: new Date().toISOString(), role: "laptop" }]);

  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const server = createServer(port);
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const get = (p: string) =>
    new Promise<{ status: number; body: string }>((resolve) => {
      http.get({ host: "127.0.0.1", port, path: p, headers: { "x-kuvend-token": store.accessToken() } }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
    });

  const ok = await get(`/api/peers/plaptop1/proxy/sessions/sabcdefgh1?x=1&token=${store.accessToken()}`);
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).path, "/api/sessions/sabcdefgh1?x=1", "this machine's key never goes on to the laptop");
  assert.ok(seen.at(-1)!.endsWith("c".repeat(48)), "the server signs in to the laptop with its own key");
  assert.equal((await get("/api/peers/plaptop1/proxy/remote/stop")).status, 403, "remote control of the laptop is not passed through");
  server.close();
  upstream.close();
  remote.stopRemote(false);
  env(LAPTOP);
});

test("start with Windows: one small launcher in the Startup folder, and off removes it", () => {
  const dir = tmp("kv-startup-");
  env({ KUVEND_STARTUP_DIR: dir });
  const where = autostart.setAutostart(true, { bin: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\kuvend\\bin\\kuvend.mjs", platform: "win32" });
  assert.ok(fs.existsSync(where));
  assert.match(fs.readFileSync(where, "utf8"), /kuvend\.mjs"" --no-open/);
  assert.equal(autostart.autostartOn({ platform: "win32" }), true);
  autostart.setAutostart(false, { platform: "win32" });
  assert.equal(fs.existsSync(where), false);
  assert.throws(() => autostart.setAutostart(true, { bin: "C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\kuvend\\bin\\kuvend.mjs", platform: "win32" }), /npm i -g kuvend/);
});

test("a server at boot: a systemd user service that runs kuvend serve with this shell's PATH, and off removes it", () => {
  const dir = tmp("kv-systemd-");
  env({ KUVEND_SYSTEMD_DIR: dir, KUVEND_STARTUP_DIR: tmp("kv-startup-") });
  const oldPath = process.env.PATH;
  process.env.PATH = "/home/me/.nvm/versions/node/v22/bin:/usr/bin";
  try {
    const where = autostart.setAutostart(true, { bin: "/home/me/.npm-global/lib/node_modules/kuvend/bin/kuvend.mjs", platform: "linux", serve: true });
    assert.equal(where, path.join(dir, "kuvend.service"));
    const unit = fs.readFileSync(where, "utf8");
    assert.match(unit, /kuvend\.mjs" serve\n/);
    assert.match(unit, /Environment="PATH=\/home\/me\/\.nvm\/versions\/node\/v22\/bin:\/usr\/bin"/);
    assert.match(unit, /Restart=always/);
    assert.match(unit, /WantedBy=default\.target/);
    assert.equal(autostart.autostartOn({ platform: "linux" }), true);
    autostart.setAutostart(false, { platform: "linux" });
    assert.equal(fs.existsSync(where), false);
    assert.equal(autostart.autostartOn({ platform: "linux" }), false);
  } finally {
    process.env.PATH = oldPath;
  }
});
