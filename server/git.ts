import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "./proc.js";
import type { FileChange } from "./store.js";

// Git does three jobs here: checkpoints (a snapshot of every file before and after each turn, so any
// turn can be undone), the change list and diffs, and safe copies (a worktree on its own branch).
// Checkpoints use a private index and refs under refs/kuvend/, so your staging area, branches and
// history are never touched.

const IDENTITY = { GIT_AUTHOR_NAME: "Kuvend", GIT_AUTHOR_EMAIL: "kuvend@localhost", GIT_COMMITTER_NAME: "Kuvend", GIT_COMMITTER_EMAIL: "kuvend@localhost" };

export async function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return run("git", args, { cwd, env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 120_000 });
}

// Checkpoints store and restore files byte for byte: no line-ending conversion from the user's
// global git settings (core.autocrlf on Windows would turn LF files into CRLF on undo).
const RAW = ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false"];
const rawGit = (cwd: string, args: string[], env: Record<string, string> = {}) => git(cwd, [...RAW, ...args], env);

export async function isRepo(cwd: string) {
  const r = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return r.ok;
}

export async function hasCommits(cwd: string) {
  return (await git(cwd, ["rev-parse", "--verify", "HEAD"])).ok;
}

export async function branch(cwd: string) {
  const r = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.ok ? r.out.trim() : null;
}

// "Turn on undo" for a folder that isn't a git repo yet.
export async function init(cwd: string) {
  const r = await git(cwd, ["init"]);
  if (!r.ok) throw new Error(r.err.trim() || "git init failed");
  const ignore = path.join(cwd, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, DEFAULT_GITIGNORE);
}

// Folders that are rebuilt, never written by hand: left out of checkpoints even when a project
// forgot to ignore them, so a snapshot stays fast and undo never deletes them.
const HEAVY = ["node_modules", ".next", ".nuxt", ".svelte-kit", ".venv", "venv", "__pycache__", ".turbo", ".cache", "target"];

// A starting .gitignore for a folder that gets git through Kuvend.
export const DEFAULT_GITIGNORE = ["node_modules/", ".env", ".env.*", "!.env.example", "dist/", "build/", ".next/", ".venv/", "__pycache__/", ".DS_Store", ""].join("\n");

function tmpIndex() {
  return path.join(os.tmpdir(), `kuvend-index-${crypto.randomBytes(6).toString("hex")}`);
}

// Every file git would see (tracked and untracked, minus .gitignore), as one commit.
export async function snapshot(cwd: string, label: string): Promise<string> {
  const index = tmpIndex();
  try {
    const env = { ...IDENTITY, GIT_INDEX_FILE: index };
    const add = await rawGit(cwd, ["add", "-A", "--", ".", ...HEAVY.map((d) => `:(exclude,glob)**/${d}/**`)], env);
    if (!add.ok) throw new Error(add.err.trim() || "git add failed");
    const tree = await git(cwd, ["write-tree"], env);
    if (!tree.ok) throw new Error(tree.err.trim() || "git write-tree failed");
    const commit = await git(cwd, ["commit-tree", tree.out.trim(), "-m", `kuvend: ${label}`], env);
    if (!commit.ok) throw new Error(commit.err.trim() || "git commit-tree failed");
    const sha = commit.out.trim();
    await git(cwd, ["update-ref", `refs/kuvend/${label}`, sha]); // kept from garbage collection
    return sha;
  } finally {
    fs.rmSync(index, { force: true });
  }
}

async function filesIn(cwd: string, sha: string): Promise<Set<string>> {
  const r = await git(cwd, ["ls-tree", "-r", "-z", "--name-only", sha]);
  return new Set(r.out.split("\0").filter(Boolean));
}

// Put every file back as it was in `sha`: changed files restored, files created since then removed.
// Ignored files (node_modules, .env) are left alone either way.
export async function restore(cwd: string, sha: string) {
  const now = await snapshot(cwd, `restore-from/${Date.now()}`);
  const [want, have] = await Promise.all([filesIn(cwd, sha), filesIn(cwd, now)]);
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).out.trim() || cwd;
  for (const f of have) if (!want.has(f)) fs.rmSync(path.join(root, f), { force: true });
  const index = tmpIndex();
  try {
    const env = { GIT_INDEX_FILE: index };
    const read = await git(cwd, ["read-tree", sha], env);
    if (!read.ok) throw new Error(read.err.trim() || "git read-tree failed");
    const out = await rawGit(root, ["checkout-index", "-a", "-f"], env);
    if (!out.ok) throw new Error(out.err.trim() || "git checkout-index failed");
  } finally {
    fs.rmSync(index, { force: true });
  }
  return now;
}

export async function changes(cwd: string, from: string, to: string): Promise<FileChange[]> {
  const [num, names] = await Promise.all([git(cwd, ["diff", "--numstat", "-z", "-M", from, to]), git(cwd, ["diff", "--name-status", "-z", "-M", from, to])]);
  const status = new Map<string, string>();
  const parts = names.out.split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; ) {
    const s = parts[i++];
    if (s.startsWith("R") || s.startsWith("C")) {
      i++; // old name
      status.set(parts[i++], "renamed");
    } else status.set(parts[i++], s === "A" ? "added" : s === "D" ? "deleted" : "modified");
  }
  const out: FileChange[] = [];
  const nparts = num.out.split("\0");
  for (let i = 0; i < nparts.length; i++) {
    const line = nparts[i];
    if (!line) continue;
    const [a, r, p] = line.split("\t");
    let file = p;
    if (p === "") {
      i += 2; // rename: old and new names follow
      file = nparts[i];
    }
    if (!file) continue;
    out.push({ path: file, status: status.get(file) ?? "modified", added: a === "-" ? 0 : Number(a), removed: r === "-" ? 0 : Number(r) });
  }
  return out;
}

export async function fileDiff(cwd: string, from: string, to: string, file: string) {
  const r = await git(cwd, ["diff", "-M", from, to, "--", file]);
  return r.out;
}

export async function fullDiff(cwd: string, from: string, to: string, cap = 60_000) {
  const r = await git(cwd, ["diff", "-M", from, to]);
  return r.out.length > cap ? `${r.out.slice(0, cap)}\n… (diff cut at ${cap} characters)` : r.out;
}

// ---------- safe copies ----------

export async function addWorktree(project: string, dir: string, name: string) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const r = await git(project, ["worktree", "add", "-b", name, dir]);
  if (!r.ok) throw new Error(r.err.trim() || "Couldn't make a safe copy");
}

// Bring a safe copy's work back: commit it on its branch, then merge into the project's current branch.
// A conflict is aborted, never left half-done in your folder.
export async function mergeBack(project: string, copy: string, name: string, message: string): Promise<{ ok: boolean; why?: string }> {
  await git(copy, ["add", "-A"]);
  const staged = await git(copy, ["diff", "--cached", "--quiet"]);
  if (!staged.ok) {
    const c = await git(copy, ["commit", "-m", message], IDENTITY);
    if (!c.ok) return { ok: false, why: c.err.trim() };
  }
  const dirty = await git(project, ["status", "--porcelain"]);
  if (dirty.out.trim()) return { ok: false, why: "Your project folder has unsaved changes. Save or undo them first, then bring the copy back." };
  const m = await git(project, ["merge", "--no-ff", "-m", `Merge ${name} (Kuvend)`, name], IDENTITY);
  if (!m.ok) {
    await git(project, ["merge", "--abort"]);
    return { ok: false, why: "The copy and your project changed the same lines, so nothing was merged. Ask the agent to rebase the copy onto your branch, or merge it yourself." };
  }
  return { ok: true };
}

// ---------- saving (commit) ----------

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // git's well-known empty tree

// What a save would contain, read from a private snapshot so checking changes nothing in your git.
export async function pendingDiff(cwd: string): Promise<{ diff: string; files: string[] }> {
  const snap = await snapshot(cwd, "save-check");
  const base = (await hasCommits(cwd)) ? "HEAD" : EMPTY_TREE; // a brand-new repo: everything is new
  const [diff, names] = await Promise.all([git(cwd, ["diff", "-M", base, snap]), git(cwd, ["diff", "--name-status", "-M", base, snap])]);
  return { diff: diff.out, files: names.out.trim().split("\n").filter(Boolean) };
}

export async function stageAll(cwd: string) {
  const r = await git(cwd, ["add", "-A"]);
  if (!r.ok) throw new Error(r.err.trim() || "git add failed");
  return (await git(cwd, ["diff", "--cached"])).out;
}

export async function stagedFiles(cwd: string) {
  return (await git(cwd, ["diff", "--cached", "--name-status"])).out.trim().split("\n").filter(Boolean);
}

export async function commit(cwd: string, message: string) {
  const c = await git(cwd, ["commit", "-m", message]);
  if (!c.ok) {
    // No identity configured is the usual first-time failure: commit as Kuvend rather than fail.
    if (/user\.email|identity/i.test(c.err)) {
      const again = await git(cwd, ["commit", "-m", message], IDENTITY);
      if (again.ok) return;
      throw new Error(again.err.trim());
    }
    throw new Error(c.err.trim() || c.out.trim() || "Commit failed");
  }
}
