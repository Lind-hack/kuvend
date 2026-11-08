import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.KUVEND_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-home-"));

const git = await import("./git.js");
const { checkDiff } = await import("./safety.js");
const { claudeParser, codexParser } = await import("./agents.js");
const { createServer } = await import("./server.js");
const { accessToken } = await import("./store.js");

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-proj-"));
  fs.writeFileSync(path.join(dir, "app.js"), "console.log('v1')\n");
  return dir;
}

test("undo puts every file back, removes files the turn created, and redo brings the turn back", async () => {
  const dir = project();
  await git.init(dir);
  assert.ok(fs.existsSync(path.join(dir, ".gitignore")), "a new repo gets a .gitignore");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "dep.js"), "dep");
  const before = await git.snapshot(dir, "t/before");
  fs.writeFileSync(path.join(dir, "app.js"), "console.log('v2')\n");
  fs.writeFileSync(path.join(dir, "new.js"), "new\n");
  const after = await git.snapshot(dir, "t/after");

  const files = await git.changes(dir, before, after);
  assert.deepEqual(files.map((f) => `${f.status} ${f.path}`).sort(), ["added new.js", "modified app.js"]);
  assert.match(await git.fileDiff(dir, before, after, "app.js"), /\+console\.log\('v2'\)/);

  const redo = await git.restore(dir, before);
  assert.equal(fs.readFileSync(path.join(dir, "app.js"), "utf8"), "console.log('v1')\n");
  assert.ok(!fs.existsSync(path.join(dir, "new.js")));
  assert.ok(fs.existsSync(path.join(dir, "node_modules", "dep.js")), "rebuilt folders are never touched");

  await git.restore(dir, redo);
  assert.equal(fs.readFileSync(path.join(dir, "app.js"), "utf8"), "console.log('v2')\n");
  assert.ok(fs.existsSync(path.join(dir, "new.js")));
  const status = await git.git(dir, ["status", "--porcelain"]);
  assert.ok(!/^A /m.test(status.out), "the user's own staging area is untouched");
});

test("the save check stops keys and .env files, and flags deletions", () => {
  const diff = [
    "diff --git a/.env b/.env",
    "new file mode 100644",
    "+++ b/.env",
    "+OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456",
    "diff --git a/src/a.ts b/src/a.ts",
    "+++ b/src/a.ts",
    '+const k = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";',
    "diff --git a/old.ts b/old.ts",
    "deleted file mode 100644",
    "-gone",
    "diff --git a/.env.example b/.env.example",
    "+++ b/.env.example",
    "+OPENAI_API_KEY=",
  ].join("\n");
  const w = checkDiff(diff);
  assert.ok(w.some((x) => x.level === "stop" && x.file === ".env" && /environment file/.test(x.title)));
  assert.ok(w.some((x) => x.level === "stop" && /OpenAI key/.test(x.title)));
  assert.ok(w.some((x) => x.level === "stop" && x.file === "src/a.ts" && /GitHub token/.test(x.title)));
  assert.ok(w.some((x) => x.level === "check" && x.file === "old.ts"));
  assert.ok(!w.some((x) => x.file === ".env.example"), "example env files are fine");
});

test("Claude's stream becomes text, tools with results, denied permissions and a cost", () => {
  const out: unknown[] = [];
  const p = claudeParser((e) => out.push(e));
  p.line({ type: "system", subtype: "init", session_id: "abc" });
  p.line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } });
  p.line({ type: "assistant", message: { content: [{ type: "text", text: "Hello" }, { type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test" } }] } });
  p.line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "1 failing" }] } });
  p.line({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.012, permission_denials: [{ tool_name: "Bash", tool_input: { command: "rm -rf build" } }] });
  assert.deepEqual(out, [
    { t: "session", id: "abc" },
    { t: "delta", text: "Hel" },
    { t: "item", item: { kind: "text", text: "Hello" } },
    { t: "item", item: { kind: "tool", id: "tu1", name: "Bash", detail: "npm test" } },
    { t: "tool_done", id: "tu1", ok: false, output: "1 failing" },
    { t: "item", item: { kind: "denied", tools: [{ name: "Bash", detail: "rm -rf build", allow: "Bash(rm -rf build)" }] } },
  ]);
  assert.deepEqual(p.result(), { ok: true, costUsd: 0.012, error: undefined });
});

test("Codex's stream becomes text, shell commands and file edits", () => {
  const out: unknown[] = [];
  const p = codexParser((e) => out.push(e));
  p.line({ type: "thread.started", thread_id: "th1" });
  p.line({ type: "item.started", item: { id: "i1", type: "command_execution", command: "ls" } });
  p.line({ type: "item.completed", item: { id: "i1", type: "command_execution", exit_code: 0, aggregated_output: "a.js" } });
  p.line({ type: "item.completed", item: { id: "i2", type: "file_change", changes: [{ path: "a.js", kind: "update" }] } });
  p.line({ type: "item.completed", item: { id: "i3", type: "agent_message", text: "Done." } });
  p.line({ type: "turn.completed" });
  assert.equal(out.length, 5);
  assert.deepEqual(out[2], { t: "tool_done", id: "i1", ok: true, output: "a.js" });
  assert.deepEqual(out[3], { t: "item", item: { kind: "tool", id: "i2:a.js", name: "Edit", detail: "a.js", ok: true } });
  assert.deepEqual(p.result(), { ok: true });
});

test("the server only answers its own page: right host, right origin, right token", async () => {
  const server = createServer(0);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  // createServer(0) can't know the port it got, so build one bound to the real port.
  server.close();
  const real = createServer(port);
  await new Promise<void>((r) => real.listen(port, "127.0.0.1", r));
  const token = accessToken();
  const get = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/api/sessions/sabcdefgh123`, { headers });
  try {
    assert.equal((await get({})).status, 401, "no token");
    assert.equal((await get({ "x-kuvend-token": "nope" })).status, 401, "wrong token");
    assert.equal((await get({ "x-kuvend-token": token, Origin: "https://evil.example" })).status, 403, "another site");
    const rebound = await new Promise<number>((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "/api/state", headers: { Host: `evil.example:${port}`, "x-kuvend-token": token } }, (res) => resolve(res.statusCode ?? 0));
    });
    assert.equal(rebound, 421, "DNS rebinding");
    assert.equal((await get({ "x-kuvend-token": token })).status, 404, "a good request reaches the routes");
  } finally {
    real.close();
  }
});

test("checking a save reads a snapshot and leaves the user's staging area alone", async () => {
  const dir = project();
  await git.init(dir);
  fs.writeFileSync(path.join(dir, "keys.js"), 'const k = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";\n');
  const p = await git.pendingDiff(dir);
  assert.ok(p.files.some((f) => f.endsWith("keys.js")));
  assert.ok(checkDiff(p.diff).some((w) => w.level === "stop"));
  const staged = await git.git(dir, ["diff", "--cached", "--name-only"]);
  assert.equal(staged.out.trim(), "", "nothing was staged");
});

test("agent errors are explained in plain words", async () => {
  const { explain } = await import("./agents.js");
  assert.match(explain(JSON.stringify({ error: { message: "The 'gpt-x' model is not supported when using Codex with a ChatGPT account." } })), /model "gpt-x"/);
  assert.match(explain("Your workspace is out of credits."), /usage limit/);
  assert.equal(explain("something odd"), "something odd");
});

test("the council: link with a code, send a take with its diff, follow the room, and turn the verdict into the next message", async () => {
  const council = await import("./council.js");
  const { saveSession } = await import("./store.js");
  // A fake Agentic OS dashboard.
  let asked: any = null;
  let status = "debating";
  const fake = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer kvd_u_0123456789abcdef_secretsecretsecretsecret") return res.writeHead(401).end("{}");
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/api/kuvend/rooms") {
        asked = JSON.parse(body);
        return res.writeHead(200, { "Content-Type": "application/json" }).end('{"id":"R-ABC123","url":"/room/R-ABC123"}');
      }
      const done = status === "done";
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({ id: "R-ABC123", status, rounds: done ? 2 : 1, agreement: done ? 85 : 40, verdict: done ? { outcome: "consensus", decision: "Keep it, add a test for the empty list", recommendation: "", next_step: "Write the test", actions: [], dissent: ["Check the total on an empty list"], confidence: 80, judge: "Gemini" } : null }),
      );
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  try {
    await assert.rejects(council.link(base, "kvd_u_0123456789abcdef_wrongwrongwrongwrongwrong"), /didn't accept/);
    assert.equal(council.councilLinked(), null, "a bad code isn't kept");
    await assert.rejects(council.link("http://example.com", "kvd_owner_secretsecretsecretsecret"), /https/);
    await council.link(base, "kvd_u_0123456789abcdef_secretsecretsecretsecret");
    assert.equal(council.councilLinked(), base);

    const dir = project();
    await git.init(dir);
    const before = await git.snapshot(dir, "c/before");
    fs.writeFileSync(path.join(dir, "app.js"), "console.log('v2')\n");
    const after = await git.snapshot(dir, "c/after");
    const now = new Date().toISOString();
    saveSession({ id: "scouncil0001", title: "t", project: dir, cwd: dir, agent: "claude", mode: "edit", agentSessions: {}, createdAt: now, updatedAt: now, turns: [{ id: "tcouncil0001", kind: "chat", agent: "claude", mode: "edit", prompt: "Print v2", status: "done", startedAt: now, before, after, items: [{ kind: "text", text: "Done, it prints v2." }] }] });

    const t = await council.ask("scouncil0001", "tcouncil0001");
    assert.equal(t.council?.roomId, "R-ABC123");
    assert.equal(t.council?.url, `${base}/room/R-ABC123`);
    assert.match(asked.task, /Print v2/);
    assert.match(asked.context, /\+console\.log\('v2'\)/, "the diff is the evidence");

    assert.equal((await council.refresh("scouncil0001", "tcouncil0001")).council?.status, "debating");
    status = "done";
    const done = await council.refresh("scouncil0001", "tcouncil0001");
    assert.equal(done.council?.verdict?.decision, "Keep it, add a test for the empty list");
    assert.match(council.verdictPrompt(done), /Keep it, add a test.*\n.*Write the test/s);
    council.unlink();
    assert.equal(council.councilLinked(), null);
  } finally {
    fake.close();
  }
});
