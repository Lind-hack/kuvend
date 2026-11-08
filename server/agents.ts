import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { killTree, run, start } from "./proc.js";
import type { AgentId, Item, Mode } from "./store.js";

// One turn of a coding agent CLI you already have installed and signed in to. Kuvend never sees your
// login: it runs `claude` and `codex` as you would in a terminal and reads their JSON event streams.
//   Claude Code: claude -p --output-format stream-json --verbose --include-partial-messages [--resume id]
//   Codex:       codex exec --json [resume id] -   (the prompt comes on stdin)

export type AgentEvent =
  | { t: "delta"; text: string } // streaming text, appended to the open message
  | { t: "item"; item: Item } // a finished piece: text, tool call, error, denied permissions
  | { t: "tool_done"; id: string; ok: boolean; output?: string }
  | { t: "session"; id: string };

export type TurnOptions = {
  agent: AgentId;
  cwd: string;
  prompt: string;
  mode: Mode;
  model?: string;
  resume?: string;
  allow?: string[]; // tools the user allowed after a denial, e.g. Bash(npm test)
  onEvent: (e: AgentEvent) => void;
};

export type TurnHandle = { done: Promise<{ ok: boolean; costUsd?: number; error?: string }>; stop: () => void };

const clip = (v: unknown, n = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const clipBlock = (v: unknown, n = 4000) => {
  const s = typeof v === "string" ? v : Array.isArray(v) ? v.map((x) => (typeof x?.text === "string" ? x.text : "")).join("\n") : JSON.stringify(v ?? "");
  return s.length > n ? `${s.slice(0, n)}\n…` : s;
};

// What a tool call is about, in one line: the command, the file, the search.
function toolDetail(input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  return clip(i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt ?? "");
}

// The exact permission rule that would have let a denied call through, for "Allow and continue".
function allowRule(name: string, input: Record<string, unknown> | undefined): string {
  if (name === "Bash" && typeof input?.command === "string") return `Bash(${input.command.slice(0, 300)})`;
  return name;
}

const CLAUDE_MODE: Record<Mode, string> = { plan: "plan", edit: "acceptEdits", full: "bypassPermissions" };
const CODEX_MODE: Record<Mode, string[]> = {
  plan: ["-s", "read-only"],
  edit: ["-s", "workspace-write"],
  full: ["--dangerously-bypass-approvals-and-sandbox"],
};

function claudeArgs(o: TurnOptions) {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", CLAUDE_MODE[o.mode]];
  if (o.resume) args.push("--resume", o.resume);
  if (o.model) args.push("--model", o.model);
  if (o.allow?.length) args.push("--allowedTools", ...o.allow);
  return args;
}

function codexArgs(o: TurnOptions) {
  const flags = ["--json", "--skip-git-repo-check", ...CODEX_MODE[o.mode], ...(o.model ? ["-m", o.model] : [])];
  return o.resume ? ["exec", "resume", ...flags, o.resume, "-"] : ["exec", ...flags, "-"];
}

// CLI errors often arrive as a JSON blob; say what went wrong and what to do about it.
export function explain(raw: string): string {
  let msg = raw;
  try {
    const j = JSON.parse(raw);
    msg = j?.error?.message ?? j?.message ?? raw;
  } catch {
    /* plain text already */
  }
  const model = msg.match(/['`"]([\w.-]+)['`"] model is not supported/i)?.[1];
  if (model) return `Your Codex settings pick the model "${model}", which your ChatGPT sign-in can't use. Choose another model for Codex in Kuvend (the model box next to the agent), or change "model" in ~/.codex/config.toml.`;
  if (/not logged in|unauthorized|401|login/i.test(msg)) return `The agent isn't signed in. Open a terminal and run its login once (claude, or codex login), then try again.`;
  if (/rate limit|usage limit|quota|429|out of credits/i.test(msg)) return `You've hit your plan's usage limit for now. Wait for it to reset, or switch to the other agent.`;
  return clip(msg, 600);
}

// ---------- parsers: one JSON line in, events out ----------

type Parser = { line: (e: any) => void; result: () => { ok: boolean; costUsd?: number; error?: string } | null };

export function claudeParser(emit: (e: AgentEvent) => void): Parser {
  let final: { ok: boolean; costUsd?: number; error?: string } | null = null;
  return {
    result: () => final,
    line: (e) => {
      if (e?.session_id && e.type === "system" && e.subtype === "init") emit({ t: "session", id: e.session_id });
      if (e?.type === "stream_event" && e.event?.type === "content_block_delta" && e.event.delta?.type === "text_delta") emit({ t: "delta", text: e.event.delta.text ?? "" });
      if (e?.type === "assistant") {
        for (const c of e.message?.content ?? []) {
          if (c?.type === "text" && c.text?.trim()) emit({ t: "item", item: { kind: "text", text: c.text } });
          if (c?.type === "tool_use") emit({ t: "item", item: { kind: "tool", id: String(c.id ?? ""), name: String(c.name ?? "tool"), detail: toolDetail(c.input) } });
        }
      }
      if (e?.type === "user") {
        for (const c of e.message?.content ?? []) {
          if (c?.type === "tool_result") emit({ t: "tool_done", id: String(c.tool_use_id ?? ""), ok: !c.is_error, output: clipBlock(c.content) });
        }
      }
      if (e?.type === "result") {
        const denied = Array.isArray(e.permission_denials) ? e.permission_denials : [];
        if (denied.length) {
          const tools = denied.slice(0, 8).map((d: any) => ({ name: String(d?.tool_name ?? "tool"), detail: toolDetail(d?.tool_input), allow: allowRule(String(d?.tool_name ?? ""), d?.tool_input) }));
          emit({ t: "item", item: { kind: "denied", tools } });
        }
        const ok = !e.is_error && e.subtype === "success";
        final = { ok, costUsd: typeof e.total_cost_usd === "number" ? e.total_cost_usd : undefined, error: ok ? undefined : clip(e.result ?? e.subtype, 400) };
      }
    },
  };
}

export function codexParser(emit: (e: AgentEvent) => void): Parser {
  let final: { ok: boolean; error?: string } | null = null;
  return {
    result: () => final,
    line: (e) => {
      if (e?.type === "thread.started" && e.thread_id) emit({ t: "session", id: e.thread_id });
      const it = e?.item ?? {};
      if (e?.type === "item.started" && it.type === "command_execution") emit({ t: "item", item: { kind: "tool", id: String(it.id ?? ""), name: "Shell", detail: clip(it.command) } });
      if (e?.type === "item.completed") {
        if (it.type === "agent_message" && it.text?.trim()) emit({ t: "item", item: { kind: "text", text: it.text } });
        else if (it.type === "command_execution") emit({ t: "tool_done", id: String(it.id ?? ""), ok: !it.exit_code, output: clipBlock(it.aggregated_output ?? "") });
        else if (it.type === "file_change") for (const c of it.changes ?? []) emit({ t: "item", item: { kind: "tool", id: `${it.id}:${c?.path}`, name: c?.kind === "add" ? "Create" : c?.kind === "delete" ? "Delete" : "Edit", detail: clip(c?.path), ok: true } });
        else if (it.type === "web_search") emit({ t: "item", item: { kind: "tool", id: String(it.id ?? ""), name: "Search", detail: clip(it.query), ok: true } });
        else if (it.type === "mcp_tool_call") emit({ t: "item", item: { kind: "tool", id: String(it.id ?? ""), name: `${it.server ?? "mcp"}.${it.tool ?? "tool"}`, detail: "", ok: it.status !== "failed" } });
        // Codex reports warnings (model metadata, skill budgets) as error items; only a failed turn is an error.
      }
      if (e?.type === "turn.completed") final = { ok: true };
      if (e?.type === "turn.failed" || e?.type === "error") final = { ok: false, error: explain(String(e.error?.message ?? e.message ?? "Codex failed")) };
    },
  };
}

// ---------- running a turn ----------

export function runTurn(o: TurnOptions): TurnHandle {
  const cmd = o.agent === "claude" ? "claude" : "codex";
  const args = o.agent === "claude" ? claudeArgs(o) : codexArgs(o);
  const parser = o.agent === "claude" ? claudeParser(o.onEvent) : codexParser(o.onEvent);
  let child: ChildProcess;
  let stopped = false;
  const done = new Promise<{ ok: boolean; costUsd?: number; error?: string }>((resolve) => {
    try {
      child = start(cmd, args, { cwd: o.cwd, env: { ...process.env, KUVEND: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, error: `Couldn't start ${cmd}: ${e instanceof Error ? e.message : e}` });
      return;
    }
    let buf = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        try {
          parser.line(JSON.parse(line));
        } catch {
          /* a line that isn't JSON contributes nothing */
        }
      }
    });
    child.stderr?.on("data", (d: Buffer) => (err = (err + d.toString("utf8")).slice(-4000)));
    child.on("error", (e) => resolve({ ok: false, error: /ENOENT/.test(String(e)) ? `${cmd} isn't installed, or isn't on your PATH.` : String(e) }));
    child.on("close", (code) => {
      if (stopped) return resolve({ ok: false, error: "Stopped" });
      const r = parser.result();
      if (r) return resolve(r);
      resolve({ ok: code === 0, error: code === 0 ? undefined : clip(err || `${cmd} exited with code ${code}`, 600) });
    });
    child.stdin?.end(o.prompt);
  });
  return {
    done,
    stop: () => {
      stopped = true;
      killTree(child);
    },
  };
}

// Models to suggest in the model box. Codex keeps the list its account can use in models_cache.json;
// Claude Code takes short aliases.
export function modelSuggestions(): Record<AgentId, string[]> {
  let codex: string[] = [];
  try {
    const file = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "models_cache.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.models) ? raw.models : [];
    codex = list.filter((m: any) => typeof m?.slug === "string" && m.visibility !== "hide").map((m: any) => m.slug).slice(0, 12);
  } catch {
    /* no cache yet: Codex fills it on first run */
  }
  return { claude: ["opus", "sonnet", "haiku"], codex };
}

// Which agents are installed and their versions, for the launch screen.
// Checked once a minute at most: starting both CLIs takes a few seconds.
let detected: { at: number; value: Promise<Record<AgentId, { installed: boolean; version?: string }>> } | null = null;
export function detectAgents(): Promise<Record<AgentId, { installed: boolean; version?: string }>> {
  if (!detected || Date.now() - detected.at > 60_000) detected = { at: Date.now(), value: detectNow() };
  return detected.value;
}

async function detectNow(): Promise<Record<AgentId, { installed: boolean; version?: string }>> {
  const [c, x] = await Promise.all([run("claude", ["--version"], { timeoutMs: 20_000 }), run("codex", ["--version"], { timeoutMs: 20_000 })]);
  return {
    claude: { installed: c.ok, version: c.ok ? c.out.trim().split("\n")[0] : undefined },
    codex: { installed: x.ok, version: x.ok ? x.out.trim().split("\n")[0] : undefined },
  };
}
