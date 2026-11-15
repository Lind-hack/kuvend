import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatFile } from "./chats.js";
import { killTree, run, start } from "./proc.js";
import type { AgentId, Item, Mode, Usage } from "./store.js";

// One turn of a coding agent CLI you already have installed and signed in to. Kuvend never sees your
// login: it runs each CLI as you would in a terminal and reads its JSON event stream, so every skill,
// MCP server, hook and setting is the CLI's own.
//   Claude Code: claude -p --output-format stream-json --verbose --include-partial-messages [--resume id]
//   Codex:       codex exec --json [resume id] -   (the prompt comes on stdin)
//   OpenCode:    opencode run --format json --agent build|plan -m <model> [--session id]   (prompt on stdin)

export type AgentEvent =
  | { t: "delta"; text: string } // streaming text, appended to the open message
  | { t: "item"; item: Item } // a finished piece: text, tool call, error, denied permissions
  | { t: "tool_done"; id: string; ok: boolean; output?: string }
  | { t: "session"; id: string }
  | { t: "usage"; usage: Usage };

// OpenCode's free DeepSeek V4.1 Flash: what Lind uses, and what OpenCode runs unless another model is picked.
export const OPENCODE_MODEL = "opencode/deepseek-v4.1-flash-free";

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

export const clip = (v: unknown, n = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export const clipBlock = (v: unknown, n = 4000) => {
  const s = typeof v === "string" ? v : Array.isArray(v) ? v.map((x) => (typeof x?.text === "string" ? x.text : "")).join("\n") : JSON.stringify(v ?? "");
  return s.length > n ? `${s.slice(0, n)}\n…` : s;
};

// What a tool call is about, in one line: the command, the file, the search.
export function toolDetail(input: Record<string, unknown> | undefined): string {
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

// OpenCode's own agents: "plan" reads and plans, "build" edits. Its permission rules come from its config.
function opencodeArgs(o: TurnOptions) {
  const args = ["run", "--format", "json", "--agent", o.mode === "plan" ? "plan" : "build", "-m", o.model || OPENCODE_MODEL];
  if (o.resume) args.push("--session", o.resume);
  return args;
}

// The command for one turn. Every prompt goes on stdin, so long prompts never hit a command-line limit.
export function agentArgs(o: TurnOptions): { cmd: string; args: string[]; stdin: string } {
  // Codex's /review is its own reviewer (`codex exec review`): the uncommitted changes, or what the flags say.
  const review = o.agent === "codex" ? o.prompt.trim().match(/^\/review(?:\s+([\s\S]*))?$/) : null;
  if (review) {
    const rest = (review[1] ?? "").trim();
    const target = rest.startsWith("--") ? rest.split(/\s+/) : ["--uncommitted", ...(rest ? [rest] : [])];
    return { cmd: "codex", args: ["exec", "--json", "--skip-git-repo-check", ...CODEX_MODE[o.mode], ...(o.model ? ["-m", o.model] : []), "review", ...target], stdin: "" };
  }
  const args = o.agent === "claude" ? claudeArgs(o) : o.agent === "codex" ? codexArgs(o) : opencodeArgs(o);
  return { cmd: o.agent, args, stdin: o.prompt };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Codex's session file has a token count after every model call: the last one is how full the context is.
export function codexUsage(rollout: string): Usage | null {
  let last: any = null;
  for (const line of rollout.split("\n")) {
    if (!line.includes('"token_count"')) continue;
    try {
      const info = JSON.parse(line)?.payload?.info;
      if (info?.last_token_usage) last = info;
    } catch {
      /* a partial line */
    }
  }
  if (!last) return null;
  const u = last.last_token_usage;
  const cacheRead = num(u.cached_input_tokens);
  return { context: num(u.input_tokens), window: typeof last.model_context_window === "number" ? last.model_context_window : null, cacheRead, cacheWrite: num(u.cache_write_input_tokens), fresh: Math.max(0, num(u.input_tokens) - cacheRead), output: num(u.output_tokens), ttlSec: null };
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
  if (/not logged in|unauthorized|401|login|invalid api key/i.test(msg)) return `The agent isn't signed in on the computer Kuvend runs on. Open a terminal there and run its login once (claude, then /login; or codex login --device-auth), then try again.`;
  if (/rate limit|usage limit|quota|429|out of credits/i.test(msg)) return `You've hit this agent's usage limit for now (${clip(msg, 160)}). Wait for it to reset, or switch to another agent.`;
  return clip(msg, 600);
}

// ---------- parsers: one JSON line in, events out ----------

type Parser = { line: (e: any) => void; result: () => { ok: boolean; costUsd?: number; error?: string } | null };

// Every slash command Claude Code said it accepts on its last start (built-ins like /goal included).
export let claudeSlash: string[] = [];

export function claudeParser(emit: (e: AgentEvent) => void): Parser {
  let final: { ok: boolean; costUsd?: number; error?: string } | null = null;
  let compacted: number | null = null;
  return {
    result: () => final,
    line: (e) => {
      if (e?.session_id && e.type === "system" && e.subtype === "init") emit({ t: "session", id: e.session_id });
      if (e?.type === "system" && e.subtype === "init" && Array.isArray(e.slash_commands)) claudeSlash = e.slash_commands.filter((c: unknown): c is string => typeof c === "string");
      if (e?.type === "system" && e.subtype === "compact_boundary" && typeof e.compact_metadata?.post_tokens === "number") compacted = e.compact_metadata.post_tokens;
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
        const usage = claudeUsage(e);
        // A /compact turn makes no model call of its own: the context is what the compaction left.
        if (usage && compacted !== null && usage.context === 0) usage.context = compacted;
        if (usage) emit({ t: "usage", usage });
      }
    },
  };
}

// The result's last model call is the prompt as it stands now; modelUsage says the model's context window.
function claudeUsage(e: any): Usage | null {
  const u = Array.isArray(e?.usage?.iterations) && e.usage.iterations.length ? e.usage.iterations.at(-1) : e?.usage;
  if (!u) return null;
  const windows = Object.values(e.modelUsage ?? {}).map((m: any) => m?.contextWindow).filter((w): w is number => typeof w === "number");
  const cc = u.cache_creation ?? e.usage?.cache_creation ?? {};
  const ttlSec = num(cc.ephemeral_1h_input_tokens) > 0 ? 3600 : num(cc.ephemeral_5m_input_tokens) > 0 ? 300 : null;
  const fresh = num(u.input_tokens);
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheWrite = num(u.cache_creation_input_tokens);
  return { context: fresh + cacheRead + cacheWrite, window: windows.length ? Math.max(...windows) : null, cacheRead, cacheWrite, fresh, output: num(u.output_tokens), ttlSec };
}

export function opencodeParser(emit: (e: AgentEvent) => void): Parser {
  let final: { ok: boolean; error?: string } | null = null;
  let session = "";
  return {
    result: () => final,
    line: (e) => {
      if (typeof e?.sessionID === "string" && e.sessionID && !session) emit({ t: "session", id: (session = e.sessionID) });
      const p = e?.part ?? {};
      if (e?.type === "text" && typeof p.text === "string" && p.text.trim()) emit({ t: "item", item: { kind: "text", text: p.text } });
      if (e?.type === "tool_use") {
        const id = String(p.callID ?? p.id ?? "");
        emit({ t: "item", item: { kind: "tool", id, name: String(p.tool ?? "tool"), detail: toolDetail(p.state?.input) } });
        const status = p.state?.status;
        if (status === "completed" || status === "error") emit({ t: "tool_done", id, ok: status === "completed", output: clipBlock(status === "error" ? p.state?.error ?? "" : p.state?.output ?? "") });
      }
      if (e?.type === "step_finish" && p.tokens) {
        const t = p.tokens;
        const cacheRead = num(t.cache?.read);
        const cacheWrite = num(t.cache?.write);
        emit({ t: "usage", usage: { context: num(t.input) + cacheRead + cacheWrite, window: null, cacheRead, cacheWrite, fresh: num(t.input), output: num(t.output), ttlSec: null } });
      }
      if (e?.type === "error") final = { ok: false, error: explain(String(e.error?.data?.message ?? e.error?.message ?? e.message ?? "OpenCode failed")) };
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
      if (e?.type === "turn.completed") {
        final = { ok: true };
        // Summed over every model call in the turn, so not the context size: runTurn reads that from the session file.
        const u = e.usage;
        if (u) emit({ t: "usage", usage: { context: null, window: null, cacheRead: num(u.cached_input_tokens), cacheWrite: num(u.cache_write_input_tokens), fresh: Math.max(0, num(u.input_tokens) - num(u.cached_input_tokens)), output: num(u.output_tokens), ttlSec: null } });
      }
      if (e?.type === "turn.failed" || e?.type === "error") final = { ok: false, error: explain(String(e.error?.message ?? e.message ?? "Codex failed")) };
    },
  };
}

// ---------- running a turn ----------

export function runTurn(o: TurnOptions): TurnHandle {
  // Tests set KUVEND_FAKE_AGENT to a script that plays the agent, so they never call a real model.
  const fake = process.env.KUVEND_FAKE_AGENT;
  const real = agentArgs(o);
  const cmd = fake ? process.execPath : real.cmd;
  const args = fake ? [fake, o.agent, ...real.args] : real.args;
  let thread = o.resume ?? "";
  const onEvent = (e: AgentEvent) => {
    if (e.t === "session") thread = e.id;
    o.onEvent(e);
  };
  const parser = o.agent === "claude" ? claudeParser(onEvent) : o.agent === "codex" ? codexParser(onEvent) : opencodeParser(onEvent);
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
      if (o.agent === "codex" && thread && !fake) {
        try {
          const file = chatFile("codex", thread);
          const usage = file ? codexUsage(fs.readFileSync(file, "utf8")) : null;
          if (usage) o.onEvent({ t: "usage", usage });
        } catch {
          /* the context meter just stays on the turn's totals */
        }
      }
      const r = parser.result();
      if (r) return resolve(r);
      resolve({ ok: code === 0, error: code === 0 ? undefined : explain(clip(err || `${cmd} exited with code ${code}`, 600)) });
    });
    child.stdin?.end(real.stdin);
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
  return { claude: ["opus", "sonnet", "haiku"], codex, opencode: [OPENCODE_MODEL, "opencode/deepseek-v4.1-flash", "opencode/deepseek-v4-pro"] };
}

// Which agents are installed, their versions, and whether they're signed in here, for the launch screen.
// Checked once a minute at most: starting the CLIs takes a few seconds.
// signedIn: false = installed but not signed in on this computer; undefined = couldn't tell.
export type AgentInfo = { installed: boolean; version?: string; signedIn?: boolean };
let detected: { at: number; value: Promise<Record<AgentId, AgentInfo>> } | null = null;
export function detectAgents(): Promise<Record<AgentId, AgentInfo>> {
  if (!detected || Date.now() - detected.at > 60_000) detected = { at: Date.now(), value: detectNow() };
  return detected.value;
}

async function detectNow(): Promise<Record<AgentId, AgentInfo>> {
  const [c, x, o, ca, xa] = await Promise.all([
    run("claude", ["--version"], { timeoutMs: 20_000 }),
    run("codex", ["--version"], { timeoutMs: 20_000 }),
    run("opencode", ["--version"], { timeoutMs: 20_000 }),
    run("claude", ["auth", "status"], { timeoutMs: 20_000 }),
    run("codex", ["login", "status"], { timeoutMs: 20_000 }),
  ]);
  const v = (r: { ok: boolean; out: string }, signedIn?: boolean): AgentInfo => ({ installed: r.ok, version: r.ok ? r.out.trim().split("\n")[0] : undefined, signedIn: r.ok ? signedIn : undefined });
  let claudeIn: boolean | undefined;
  try {
    claudeIn = JSON.parse(ca.out)?.loggedIn === true;
  } catch {
    claudeIn = undefined;
  }
  // OpenCode's free models need no sign-in.
  // `codex login status` answers on stderr.
  return { claude: v(c, claudeIn), codex: v(x, xa.ok ? /logged in/i.test(xa.out + xa.err) : undefined), opencode: v(o, true) };
}
