import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { killTree, start } from "./proc.js";

// "Run it": start the project's own dev command, keep the last lines it printed, spot the address it
// serves on and the errors it prints, so one tap can hand the error to the agent.

export type RunState = {
  running: boolean;
  command: string | null;
  url: string | null;
  lines: { at: number; text: string; error: boolean }[];
  exitCode: number | null;
  installing: boolean;
};

type Proc = { id: string; child: ChildProcess; state: RunState };
const procs = new Map<string, Proc>(); // by session id
const listeners = new Map<string, Set<(s: RunState) => void>>();
const notify = (p: Proc) => {
  for (const l of listeners.get(p.id) ?? []) l(p.state);
};

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'`)]*)?/i;
const ERROR_RE = /\b(error|failed|exception|cannot find|not found|unhandled|traceback|syntaxerror|typeerror|referenceerror)\b/i;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

function packageManager(dir: string) {
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock"))) return "bun";
  return "npm";
}

// The command a person would type to start this project, or null when there's nothing obvious.
export function detectCommand(dir: string): { cmd: string; args: string[]; label: string; needsInstall: boolean } | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const scripts = pkg?.scripts ?? {};
    const name = ["dev", "start", "serve", "preview"].find((s) => typeof scripts[s] === "string");
    if (name) {
      const pm = packageManager(dir);
      return { cmd: pm, args: ["run", name], label: `${pm} run ${name}`, needsInstall: Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }).length > 0 && !fs.existsSync(path.join(dir, "node_modules")) };
    }
  } catch {
    /* no package.json */
  }
  for (const f of ["manage.py", "app.py", "main.py"]) {
    if (fs.existsSync(path.join(dir, f))) {
      const args = f === "manage.py" ? [f, "runserver"] : [f];
      return { cmd: process.platform === "win32" ? "python" : "python3", args, label: `python ${args.join(" ")}`, needsInstall: false };
    }
  }
  return null;
}

export function runState(id: string): RunState {
  return procs.get(id)?.state ?? { running: false, command: null, url: null, lines: [], exitCode: null, installing: false };
}

export function onRunState(id: string, fn: (s: RunState) => void) {
  const set = listeners.get(id) ?? new Set();
  set.add(fn);
  listeners.set(id, set);
  return () => set.delete(fn);
}

function attach(p: Proc, child: ChildProcess, onExit?: (code: number | null) => void) {
  const push = (chunk: Buffer) => {
    for (const raw of chunk.toString("utf8").replace(ANSI, "").split(/\r?\n/)) {
      const text = raw.trimEnd();
      if (!text) continue;
      p.state.lines.push({ at: Date.now(), text: text.slice(0, 2000), error: ERROR_RE.test(text) });
      if (!p.state.url) p.state.url = text.match(URL_RE)?.[0]?.replace("0.0.0.0", "localhost") ?? null;
    }
    if (p.state.lines.length > 600) p.state.lines.splice(0, p.state.lines.length - 600);
    notify(p);
  };
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  child.on("close", (code) => {
    onExit?.(code);
  });
  child.on("error", (e) => push(Buffer.from(`Couldn't start: ${e.message}`)));
}

export function startApp(id: string, dir: string, custom?: string): RunState {
  stopApp(id);
  const found = custom?.trim() ? null : detectCommand(dir);
  const parts = custom?.trim() ? custom.trim().split(/\s+/) : found ? [found.cmd, ...found.args] : null;
  if (!parts) throw new Error("No start command found. Type the command you use to run this project.");
  const state: RunState = { running: true, command: parts.join(" "), url: null, lines: [], exitCode: null, installing: !!found?.needsInstall };
  const p: Proc = { id, child: undefined as unknown as ChildProcess, state };
  procs.set(id, p);
  notify(p);
  const env = { ...process.env, FORCE_COLOR: "0", BROWSER: "none" };
  const launch = () => {
    state.installing = false;
    const child = start(parts[0], parts.slice(1), { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    p.child = child;
    attach(p, child, (code) => {
      state.running = false;
      state.exitCode = code;
      notify(p);
    });
  };
  if (found?.needsInstall) {
    state.lines.push({ at: Date.now(), text: `Installing packages first (${found.cmd} install)…`, error: false });
    const install = start(found.cmd, ["install"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    p.child = install;
    attach(p, install, (code) => {
      if (procs.get(id) !== p || !state.running) return;
      if (code === 0) launch();
      else {
        state.running = false;
        state.installing = false;
        state.exitCode = code;
        notify(p);
      }
    });
  } else launch();
  return state;
}

export function stopApp(id: string) {
  const p = procs.get(id);
  if (!p) return;
  p.state.running = false;
  killTree(p.child);
  notify(p);
}

export function stopAll() {
  for (const id of procs.keys()) stopApp(id);
}

// The lines worth handing to the agent: the last error and what led up to it.
export function errorContext(id: string): string | null {
  const lines = runState(id).lines;
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].error) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;
  return lines
    .slice(Math.max(0, last - 40), Math.min(lines.length, last + 15))
    .map((l) => l.text)
    .join("\n");
}
