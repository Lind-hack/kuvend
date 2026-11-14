import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.KUVEND_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-home-"));

const { opencodeParser, claudeParser, codexParser, codexUsage, agentArgs, explain } = await import("./agents.js");
const { AGENTS } = await import("./store.js");

// Lines from a real `opencode run --format json` (OpenCode 2.1.4, DeepSeek V4.1 Flash), trimmed.
const SID = "ses_e23e2d145ffe1I9zObgM14lGrb";
const OPENCODE = [
  { type: "step_start", sessionID: SID, part: { type: "step-start" } },
  { type: "text", sessionID: SID, part: { id: "prt_1", type: "text", text: "I'll read the file first." } },
  { type: "tool_use", sessionID: SID, part: { type: "tool", id: "call_0ed9", tool: "read", state: { status: "completed", input: { path: "a.txt" }, output: "1: hello" } } },
  { type: "step_finish", sessionID: SID, part: { type: "step-finish", reason: "tool-calls", cost: 0, tokens: { input: 30013, output: 45, reasoning: 0, cache: { read: 1536, write: 0 } } } },
  { type: "text", sessionID: SID, part: { id: "prt_2", type: "text", text: "hello" } },
];

test("OpenCode's stream becomes the session, text, a finished tool call and usage", () => {
  const out: any[] = [];
  const p = opencodeParser((e) => out.push(e));
  for (const l of OPENCODE) p.line(l);
  assert.deepEqual(out[0], { t: "session", id: SID }, "the session id comes once, first");
  assert.equal(out.filter((e) => e.t === "session").length, 1);
  assert.deepEqual(
    out.filter((e) => e.t === "item").map((e) => e.item),
    [
      { kind: "text", text: "I'll read the file first." },
      { kind: "tool", id: "call_0ed9", name: "read", detail: "a.txt" },
      { kind: "text", text: "hello" },
    ],
  );
  assert.deepEqual(out.find((e) => e.t === "tool_done"), { t: "tool_done", id: "call_0ed9", ok: true, output: "1: hello" });
  assert.deepEqual(out.find((e) => e.t === "usage").usage, { context: 31549, window: null, cacheRead: 1536, cacheWrite: 0, fresh: 30013, output: 45, ttlSec: null });
  assert.equal(p.result(), null, "no error: the exit code decides");
});

test("OpenCode errors are explained, and a tool that failed is marked failed", () => {
  const out: any[] = [];
  const p = opencodeParser((e) => out.push(e));
  p.line({ type: "tool_use", sessionID: SID, part: { id: "c1", tool: "bash", state: { status: "error", input: { command: "npm test" }, error: "exit 1" } } });
  p.line({ type: "error", sessionID: SID, error: { name: "APIError", data: { message: "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models." } } });
  assert.deepEqual(out.find((e) => e.t === "tool_done"), { t: "tool_done", id: "c1", ok: false, output: "exit 1" });
  assert.equal(p.result()?.ok, false);
  assert.match(p.result()?.error ?? "", /usage limit/);
});

test("Claude's result carries how full the context is and how long its prompt cache stays warm", () => {
  const out: any[] = [];
  const p = claudeParser((e) => out.push(e));
  const it = { input_tokens: 2, cache_read_input_tokens: 14507, cache_creation_input_tokens: 34313, output_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 34313 } };
  p.line({
    type: "result",
    subtype: "success",
    is_error: false,
    total_cost_usd: 0.007,
    usage: { ...it, input_tokens: 9, iterations: [{ input_tokens: 7, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, it] },
    modelUsage: { "claude-haiku-5-5": { contextWindow: 1000000 } },
  });
  assert.deepEqual(out.find((e) => e.t === "usage").usage, { context: 48822, window: 1000000, cacheRead: 14507, cacheWrite: 34313, fresh: 2, output: 4, ttlSec: 3600 }, "the last model call is how full the context is now");
  const five: any[] = [];
  const q = claudeParser((e) => five.push(e));
  q.line({ type: "result", subtype: "success", is_error: false, usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 10, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 } } });
  assert.equal(five.find((e) => e.t === "usage").usage.ttlSec, 300, "a 5-minute cache write");
  assert.equal(five.find((e) => e.t === "usage").usage.window, null, "no window reported: unknown, not guessed");
});

test("after /compact, the context is what the compaction left", () => {
  const out: any[] = [];
  const p = claudeParser((e) => out.push(e));
  p.line({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 55549, post_tokens: 21106 } });
  p.line({ type: "result", subtype: "success", is_error: false, usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }, modelUsage: {} });
  assert.deepEqual(out.find((e) => e.t === "usage").usage, { context: 21106, window: null, cacheRead: 0, cacheWrite: 0, fresh: 0, output: 0, ttlSec: null });
});

test("Codex: the turn's usage, then exact context from its own session file", () => {
  const out: any[] = [];
  const p = codexParser((e) => out.push(e));
  p.line({ type: "turn.completed", usage: { input_tokens: 97831, cached_input_tokens: 89088, cache_write_input_tokens: 0, output_tokens: 959 } });
  assert.deepEqual(out.find((e) => e.t === "usage").usage, { context: null, window: null, cacheRead: 89088, cacheWrite: 0, fresh: 8743, output: 959, ttlSec: null });
  const rollout = [
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 1 }, model_context_window: 258400 } } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 20140, cached_input_tokens: 19968, cache_write_input_tokens: 0, output_tokens: 63 }, model_context_window: 258400 } } }),
    "not json",
  ].join("\n");
  assert.deepEqual(codexUsage(rollout), { context: 20140, window: 258400, cacheRead: 19968, cacheWrite: 0, fresh: 172, output: 63, ttlSec: null }, "the last token count wins");
  assert.equal(codexUsage("{}\n"), null);
});

test("each agent gets its own command line", () => {
  assert.deepEqual(AGENTS, ["claude", "codex", "opencode"]);
  const base = { cwd: ".", prompt: "fix it", onEvent: () => {} };
  assert.deepEqual(agentArgs({ ...base, agent: "opencode", mode: "edit", model: "opencode/deepseek-v4.1-flash-free", resume: SID }), {
    cmd: "opencode",
    args: ["run", "--format", "json", "--agent", "build", "-m", "opencode/deepseek-v4.1-flash-free", "--session", SID],
    stdin: "fix it",
  });
  assert.deepEqual(agentArgs({ ...base, agent: "opencode", mode: "plan" }).args, ["run", "--format", "json", "--agent", "plan", "-m", "opencode/deepseek-v4.1-flash-free"], "DeepSeek V4.1 Flash unless another model is picked");
  assert.equal(agentArgs({ ...base, agent: "claude", mode: "edit" }).cmd, "claude");
  assert.equal(agentArgs({ ...base, agent: "codex", mode: "edit" }).stdin, "fix it");
});

test("/review on Codex runs its own reviewer, on the uncommitted changes unless told otherwise", () => {
  const base = { cwd: ".", onEvent: () => {}, agent: "codex" as const, mode: "edit" as const, model: "gpt-5.6-sol" };
  assert.deepEqual(agentArgs({ ...base, prompt: "/review" }), { cmd: "codex", args: ["exec", "--json", "--skip-git-repo-check", "-s", "workspace-write", "-m", "gpt-5.6-sol", "review", "--uncommitted"], stdin: "" });
  assert.deepEqual(agentArgs({ ...base, prompt: "/review focus on the auth code" }).args.slice(-2), ["--uncommitted", "focus on the auth code"]);
  assert.deepEqual(agentArgs({ ...base, prompt: "/review --base main" }).args.slice(-3), ["review", "--base", "main"]);
  assert.equal(agentArgs({ ...base, prompt: "/reviewer is a skill" }).args.includes("review"), false, "only the command itself");
});

test("the / menu lists each agent's own commands and skills, minus the ones switched off", async () => {
  const { listCommands } = await import("./commands.js");
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-cmds-"));
  const put = (rel: string, data: string) => {
    fs.mkdirSync(path.dirname(path.join(h, rel)), { recursive: true });
    fs.writeFileSync(path.join(h, rel), data);
  };
  put(".claude/skills/tdd/SKILL.md", "---\nname: tdd\ndescription: Test-driven development. Red, green, refactor.\n---\nbody");
  put(".claude/skills/ask-matt/SKILL.md", "---\nname: ask-matt\ndescription: >-\n  Ask Matt Pocock style\n  questions\n---\n");
  put(".claude/skills/caveman-help/SKILL.md", "---\nname: caveman-help\ndescription: help\n---\n");
  put(".claude/commands/goal.md", "---\ndescription: Set the goal for this chat\n---\nDo it");
  put(".claude/commands/git/ship.md", "Ship it");
  put(".claude/settings.json", JSON.stringify({ skillOverrides: { "caveman-help": "off" }, enabledPlugins: { "off@m": false } }));
  put(".claude/plugins/installed_plugins.json", JSON.stringify({ plugins: { "figma@m": [{ installPath: path.join(h, "p/figma") }], "off@m": [{ installPath: path.join(h, "p/off") }] } }));
  put("p/figma/skills/implement-design/SKILL.md", "---\nname: implement-design\ndescription: Figma to code\n---\n");
  put("p/off/skills/nope/SKILL.md", "---\nname: nope\n---\n");
  put(".codex/skills/tdd/SKILL.md", "---\nname: tdd\ndescription: TDD for Codex\n---\n");
  put(".codex/prompts/explain.md", "Explain $1");
  put(".agents/skills/impeccable/SKILL.md", "---\nname: impeccable\ndescription: Design polish\n---\n");
  put(".config/opencode/command/deploy.md", "---\ndescription: Deploy it\n---\n");
  put(".codex/skills/code-review/SKILL.md", "---\nname: code-review\ndescription: Review\n---\n");
  fs.symlinkSync(path.join(h, ".codex/skills/code-review"), path.join(h, ".claude/skills/code-review"), process.platform === "win32" ? "junction" : "dir");

  const claude = listCommands("claude", h);
  const names = claude.map((c) => c.name);
  for (const n of ["tdd", "ask-matt", "code-review", "goal", "git:ship", "figma:implement-design", "compact"]) assert.ok(names.includes(n), `claude has /${n}`);
  for (const n of ["caveman-help", "off:nope", "nope"]) assert.ok(!names.includes(n), `claude hides /${n}`);
  assert.equal(claude.find((c) => c.name === "tdd")?.description, "Test-driven development. Red, green, refactor.");
  assert.equal(claude.find((c) => c.name === "ask-matt")?.description, "Ask Matt Pocock style questions", "folded YAML");
  assert.deepEqual(listCommands("codex", h).map((c) => c.name).sort(), ["code-review", "impeccable", "prompts:explain", "review", "tdd"]);
  assert.ok(listCommands("opencode", h).some((c) => c.name === "deploy"));
});

test("a CLI that isn't signed in says where to sign in", () => {
  assert.match(explain("Invalid API key · Please run /login"), /isn't signed in/);
  assert.match(explain("Not logged in"), /isn't signed in/);
});
