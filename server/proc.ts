import type { ChildProcess, SpawnOptions } from "node:child_process";
import { execFile } from "node:child_process";
import spawn from "cross-spawn";

// cross-spawn runs `claude.cmd` / `codex.cmd` on Windows with arguments escaped for cmd.exe, so nothing
// a user types is ever read by a shell. Prompts go on stdin, never on the command line.
export function start(cmd: string, args: string[], opts: SpawnOptions): ChildProcess {
  return spawn(cmd, args, { ...opts, windowsHide: true, detached: process.platform !== "win32" });
}

// Stop a process and everything it started (an agent's shell commands, a dev server's watchers).
export function killTree(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

// A command's output, or null when it fails. Used for git and for checking which agents are installed.
export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {}): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, out: "", err: String(e) });
      return;
    }
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (err += d.toString("utf8")));
    const timer = setTimeout(() => killTree(child), opts.timeoutMs ?? 60_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, out, err: err || String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out, err });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
}
