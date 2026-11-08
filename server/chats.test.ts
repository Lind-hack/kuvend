import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Terminal chats, short pairing codes, two devices at once, and handing a session to another Kuvend.

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
process.env.KUVEND_HOME = tmp("kuvend-home-");
process.env.CLAUDE_CONFIG_DIR = tmp("kuvend-claude-");
process.env.CODEX_HOME = tmp("kuvend-codex-");
// A stand-in agent: answers every turn after a short pause, so tests never call a real model.
const fake = path.join(tmp("kuvend-fake-"), "agent.mjs");
fs.writeFileSync(
  fake,
  `const agent = process.argv[2];
let input = ""; process.stdin.on("data", (d) => (input += d)); process.stdin.on("end", () => setTimeout(() => {
  if (agent === "claude") {
    console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "fake-claude" }));
    console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok: " + input.slice(0, 40) }] } }));
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0 }));
  } else {
    console.log(JSON.stringify({ type: "thread.started", thread_id: "fake-codex" }));
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }));
    console.log(JSON.stringify({ type: "turn.completed" }));
  }
}, 300));`,
);
process.env.KUVEND_FAKE_AGENT = fake;

const chats = await import("./chats.js");
const sessions = await import("./sessions.js");
const remote = await import("./remote.js");
const handoff = await import("./handoff.js");
const git = await import("./git.js");
const { createServer } = await import("./server.js");
const { accessToken, readSession } = await import("./store.js");

const line = (o: unknown) => JSON.stringify(o) + "\n";
const project = () => {
  const dir = tmp("kuvend-proj-");
  fs.writeFileSync(path.join(dir, "app.js"), "console.log('v1')\n");
  return dir;
};

function claudeChat(cwd: string, id: string, entrypoint = "cli") {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR!, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const base = { cwd, sessionId: id, entrypoint, isSidechain: false };
  fs.writeFileSync(
    path.join(dir, `${id}.jsonl`),
    [
      line({ type: "permission-mode", permissionMode: "auto", sessionId: id }),
      line({ ...base, type: "user", isMeta: true, message: { role: "user", content: "<local-command-caveat>ignore</local-command-caveat>" }, timestamp: "2026-11-01T10:00:00Z" }),
      line({ ...base, type: "user", message: { role: "user", content: [{ type: "text", text: "Add a login page" }] }, timestamp: "2026-11-01T10:00:01Z" }),
      line({ ...base, type: "assistant", message: { content: [{ type: "text", text: "Reading the app first." }, { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "app.js" } }] }, timestamp: "2026-11-01T10:00:02Z" }),
      line({ ...base, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "console.log('v1')" }] }, timestamp: "2026-11-01T10:00:03Z" }),
      line({ ...base, type: "assistant", message: { content: [{ type: "text", text: "Done: login.html added." }] }, timestamp: "2026-11-01T10:00:04Z" }),
      line({ ...base, type: "user", message: { role: "user", content: "<system-reminder>context</system-reminder>\nNow style it" }, timestamp: "2026-11-01T10:01:00Z" }),
      line({ ...base, type: "assistant", message: { content: [{ type: "text", text: "Styled." }] }, timestamp: "2026-11-01T10:01:05Z" }),
      line({ type: "ai-title", aiTitle: "Login page", sessionId: id }),
    ].join(""),
  );
}

function codexChat(cwd: string, id: string, source = "cli") {
  const dir = path.join(process.env.CODEX_HOME!, "sessions", "2026", "11", "02");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `rollout-2026-11-02T09-00-00-${id}.jsonl`),
    [
      line({ timestamp: "2026-11-02T09:00:00Z", type: "session_meta", payload: { id, cwd, source, originator: source === "exec" ? "codex_exec" : "codex_cli_rs" } }),
      line({ timestamp: "2026-11-02T09:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>x</environment_context>" }] } }),
      line({ timestamp: "2026-11-02T09:00:01Z", type: "event_msg", payload: { type: "user_message", message: "Fix the failing test" } }),
      line({ timestamp: "2026-11-02T09:00:02Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["npm", "test"] }), call_id: "c1" } }),
      line({ timestamp: "2026-11-02T09:00:03Z", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "1 passing" } }),
      line({ timestamp: "2026-11-02T09:00:04Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Fixed it." }] } }),
    ].join(""),
  );
}

test("every terminal chat on this computer is listed, newest first; Kuvend's own background runs are not", async () => {
  const dir = project();
  claudeChat(dir, "11111111-aaaa-4bbb-8ccc-000000000001");
  claudeChat(dir, "11111111-aaaa-4bbb-8ccc-000000000002", "sdk-cli");
  codexChat(dir, "019f0000-0000-7000-8000-000000000003");
  codexChat(dir, "019f0000-0000-7000-8000-000000000004", "exec");
  const list = await chats.listChats();
  const ids = list.map((c) => c.id);
  assert.ok(ids.includes("11111111-aaaa-4bbb-8ccc-000000000001"));
  assert.ok(ids.includes("019f0000-0000-7000-8000-000000000003"));
  assert.ok(!ids.includes("11111111-aaaa-4bbb-8ccc-000000000002"), "claude -p runs are Kuvend's or a script's, not a chat");
  assert.ok(!ids.includes("019f0000-0000-7000-8000-000000000004"), "codex exec runs too");
  const c = list.find((x) => x.agent === "claude")!;
  assert.equal(c.title, "Login page");
  assert.equal(c.cwd, dir);
  assert.equal(c.last, "Now style it");
  assert.equal(list.find((x) => x.agent === "codex")!.title, "Fix the failing test");
});

test("a terminal chat's history becomes turns, and importing it continues the same conversation", async () => {
  const dir = project();
  const id = "11111111-aaaa-4bbb-8ccc-000000000010";
  claudeChat(dir, id);
  const turns = chats.readChat("claude", id)!.turns;
  assert.deepEqual(
    turns.map((t) => t.prompt),
    ["Add a login page", "Now style it"],
  );
  const tool = turns[0].items.find((i) => i.kind === "tool");
  assert.deepEqual(tool && { name: tool.name, detail: tool.detail, ok: tool.ok }, { name: "Read", detail: "app.js", ok: true });
  assert.ok(turns[0].items.some((i) => i.kind === "text" && i.text === "Done: login.html added."));

  const s = await chats.importChat("claude", id);
  assert.equal(s.cwd, dir);
  assert.equal(s.agentSessions.claude, id, "the next message resumes this exact chat, with all its context");
  assert.equal(s.turns.length, 2);
  assert.equal(s.title, "Login page");
  const again = await chats.importChat("claude", id);
  assert.equal(again.id, s.id, "importing twice opens the same session");

  const codexId = "019f0000-0000-7000-8000-000000000011";
  codexChat(dir, codexId);
  const cx = chats.readChat("codex", codexId)!.turns;
  assert.equal(cx[0].prompt, "Fix the failing test");
  assert.ok(cx[0].items.some((i) => i.kind === "tool" && i.detail === "npm test" && i.ok));
  assert.ok(cx[0].items.some((i) => i.kind === "text" && i.text === "Fixed it."));
  assert.equal(chats.readChat("claude", "../../etc/passwd"), null, "ids are checked, never used as paths");
});

test("a phone or laptop sending at the same moment: one turn runs, the other is told to wait", async () => {
  const s = await sessions.createSession({ project: project(), agent: "claude", mode: "plan" });
  const results = await Promise.allSettled([sessions.send(s.id, { prompt: "one" }), sessions.send(s.id, { prompt: "two" })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason), /still working/);
  await new Promise((r) => setTimeout(r, 1500));
  const after = readSession(s.id)!;
  assert.equal(after.turns.length, 1);
  assert.equal(after.turns[0].status, "done");
});

test("a home-screen app pairs by typing a short code; the code is forgiving about case and dashes", () => {
  const { short } = remote.newPairingCode();
  assert.match(short, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const typed = short.replace("-", " ").toLowerCase();
  const out = remote.pair(typed, "iPhone");
  assert.match(out.token, /^[a-f0-9]{48}$/);
  assert.throws(() => remote.pair(short, "again"), /expired|doesn't match/, "a code pairs one device");
});

test("handing a session to another Kuvend: the chat, its history and the code (uncommitted work too) arrive, and come back", async () => {
  const dir = project();
  await git.init(dir);
  await git.stageAll(dir);
  await git.commit(dir, "first");
  fs.writeFileSync(path.join(dir, "app.js"), "console.log('work in progress')\n");
  const id = "11111111-aaaa-4bbb-8ccc-000000000020";
  claudeChat(dir, id);
  const s = await chats.importChat("claude", id);

  const pkg = await handoff.exportSession(s.id);
  assert.equal(pkg.session.title, "Login page");
  assert.ok(pkg.agentFile && pkg.agentFile.text.includes("Add a login page"));
  assert.ok(pkg.bundle && pkg.bundle.data.length > 0);

  // The other machine: its own homes.
  const other = { KUVEND_HOME: tmp("kuvend-home2-"), CLAUDE_CONFIG_DIR: tmp("kuvend-claude2-"), KUVEND_PROJECTS: tmp("kuvend-projects2-") };
  const saved = { KUVEND_HOME: process.env.KUVEND_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, KUVEND_PROJECTS: process.env.KUVEND_PROJECTS };
  Object.assign(process.env, other);
  try {
    const there = await handoff.importSession(JSON.parse(JSON.stringify(pkg)));
    assert.notEqual(there.cwd, dir);
    assert.equal(fs.readFileSync(path.join(there.cwd, "app.js"), "utf8"), "console.log('work in progress')\n", "uncommitted work travels too");
    assert.equal(there.agentSessions.claude, id);
    assert.equal(there.turns.length, 2);
    const encoded = there.cwd.replace(/[^a-zA-Z0-9]/g, "-");
    assert.ok(fs.existsSync(path.join(other.CLAUDE_CONFIG_DIR, "projects", encoded, `${id}.jsonl`)), "Claude Code finds the chat to resume from the new folder");
    assert.equal(there.handoff?.from, pkg.from);
    assert.ok(there.cwd.startsWith(other.KUVEND_PROJECTS), "a handoff gets a folder of its own, even when a project with that path exists here");
    assert.equal(fs.readFileSync(path.join(dir, "app.js"), "utf8"), "console.log('work in progress')\n", "the sending project is untouched");

    // Coming home: into the original project, as a safe copy on its own branch.
    const back = await handoff.importSession({ ...JSON.parse(JSON.stringify(pkg)), project: { name: "p", path: dir } }, there.id);
    assert.equal(back.project, dir);
    assert.ok(back.branch?.startsWith("kuvend/from-"));
    assert.notEqual(back.cwd, dir, "your folder stays as it is until you merge the copy");
    assert.equal(fs.readFileSync(path.join(back.cwd, "app.js"), "utf8"), "console.log('work in progress')\n");
  } finally {
    Object.assign(process.env, saved);
  }
});

test("a paired computer can send and fetch sessions over its route; a phone's key can too, nobody else", async () => {
  const port = 47_000 + Math.floor(Math.random() * 1000);
  const server = createServer(port);
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  remote.__test.route([`peer.example:${port}`]);
  const { code } = remote.newPairingCode();
  const { token } = remote.pair(code, "Laptop");
  const call = (method: string, p: string, key: string, body?: unknown) =>
    new Promise<{ status: number; json: any }>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { Host: `peer.example:${port}`, "x-kuvend-token": key, "Content-Type": "application/json" } }, (res) => {
        let raw = "";
        res.on("data", (d) => (raw += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : null }));
      });
      req.end(body ? JSON.stringify(body) : undefined);
    });
  const dir = project();
  const s = await sessions.createSession({ project: dir, agent: "codex", mode: "plan", title: "Peer test" });
  const pkg = await handoff.exportSession(s.id);
  assert.equal((await call("POST", "/api/handoff/import", accessToken(), pkg)).status, 401, "the install key never works over a remote route");
  const sent = await call("POST", "/api/handoff/import", token, pkg);
  assert.equal(sent.status, 200);
  assert.equal(sent.json.title, "Peer test");
  const back = await call("GET", `/api/handoff/export/${sent.json.id}`, token);
  assert.equal(back.status, 200);
  assert.equal(back.json.session.title, "Peer test");
  server.close();
});
