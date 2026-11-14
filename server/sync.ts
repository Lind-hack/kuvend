import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { home } from "./store.js";

// Your setup, the same on the server: skills, agents, commands, rules, CLAUDE.md / AGENTS.md, settings with
// hooks and permissions, MCP servers with their keys, plugins, and OpenCode's config. Copied from the
// laptop's home into the server user's home, so the CLIs there read exactly what they read here.
//
// Never copied: logins (.credentials.json, auth.json), chat history, and environments built for this
// machine (node_modules, Python venvs, browsers, .exe/.dll): those are rebuilt on the server, and the
// report names where. A hook or MCP server that only runs on Windows (an .exe, PowerShell, cmd) is left
// out and reported; every other command is kept, with this home's paths pointed at the server's.
//
// Only what changed travels: the laptop sends a manifest of hashes, the server answers which it lacks.

export type SyncReport = {
  at: string;
  files: number;
  bytes: number;
  counts: { claudeSkills: number; codexSkills: number; opencodeSkills: number; sharedSkills: number; plugins: number; mcp: number; hooks: number };
  skipped: { what: string; why: string }[];
  envDirs: string[];
};
// A file is either reshaped here (data) or copied as it is on disk (abs, read only when the server needs it).
export type BundleFile = { data?: Buffer; abs?: string; size: number; mtimeMs: number; secret: boolean };
export type Bundle = { files: Map<string, BundleFile>; report: SyncReport };
export type ManifestEntry = { path: string; sha: string; size: number };
export type ApplyInput = { files: { path: string; data: string; secret: boolean }[]; manifest?: ManifestEntry[] | null; report?: SyncReport | null };

// Folders copied whole, and single files (some reshaped on the way). Paths are relative to the home.
const DIRS = [
  ".claude/skills", ".claude/agents", ".claude/commands", ".claude/rules", ".claude/output-styles", ".claude/hooks", ".claude/statusline",
  ".claude/plugins/cache", ".claude/plugins/marketplaces",
  ".codex/skills", ".codex/prompts", ".codex/rules", ".codex/scripts",
  ".config/opencode/skills", ".config/opencode/plugins", ".config/opencode/agent", ".config/opencode/agents", ".config/opencode/command", ".config/opencode/commands",
  ".agents/skills",
];
const MCP = ".claude.json#mcpServers"; // only the mcpServers key of ~/.claude.json, merged into the server's own file
const FILES = [
  ".claude/CLAUDE.md", ".claude/settings.json", MCP, ".claude/plugins/installed_plugins.json", ".claude/plugins/known_marketplaces.json", ".claude/plugins/blocklist.json",
  ".codex/AGENTS.md", ".codex/config.toml", ".codex/hooks.json",
  ".config/opencode/opencode.json", ".config/opencode/opencode.jsonc", ".config/opencode/AGENTS.md",
  "CLAUDE.md", "AGENTS.md", // the home folder's own: rules for every project under it
];
const SECRET = new Set([".claude/settings.json", MCP, ".codex/config.toml", ".config/opencode/opencode.json", ".config/opencode/opencode.jsonc"]);
const NEVER = new Set([".credentials.json", "auth.json"]);
const ENV_DIRS = new Set(["node_modules", ".venv", "venv", "ms-playwright"]);
// `.system`: the skills Codex ships and rewrites itself; the server's Codex installs its own.
const SKIP_DIRS = new Set([".git", "__pycache__", ".cache", ".pytest_cache", ".mypy_cache", ".system"]);
const SKIP_EXT = /\.(exe|dll|pyd|node|lnk|msi)$/i;
const MAX_FILE = 25 * 1024 * 1024;

const winOnly = (cmd: unknown) => typeof cmd === "string" && (/\.(exe|cmd|bat|ps1)\b/i.test(cmd) || /^\s*["']?(powershell|pwsh|cmd)(\.exe)?["']?(\s|$)/i.test(cmd));
const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 80);
// The program a TOML line runs: `command = "x"` or `notify = ["x", …]`.
const tomlProgram = (line: string) => line.match(/=\s*\[?\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/)?.slice(1).find((v) => v !== undefined) ?? "";

// This home's paths, however a config writes them (C:\Users\x, C:/Users/x, C:\\Users\\x), pointed at the server's.
function homeMapper(src: string, dest: string) {
  const sep = String.raw`(?:\\\\|\\|/)`;
  const parts = path.resolve(src).split(/[\\/]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`${parts.join(sep)}((?:${sep}[^\\\\/"'\\s,\\[\\]]+)*)`, "gi");
  return (text: string) => text.replace(re, (_m, tail: string) => dest.replace(/\/+$/, "") + tail.replace(/\\\\|\\/g, "/"));
}

function mapStrings(v: any, map: (s: string) => string): any {
  if (typeof v === "string") return map(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, map));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [map(k), mapStrings(x, map)]));
  return v;
}

// Claude Code and Codex share one hooks shape: { Event: [{ matcher, hooks: [{ type, command }] }] }.
function filterHooks(hooks: any, label: string, skipped: SyncReport["skipped"]): { hooks: any; kept: number } {
  let kept = 0;
  const out: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    const g2 = groups
      .map((g: any) => ({
        ...g,
        hooks: (Array.isArray(g?.hooks) ? g.hooks : []).filter((h: any) => {
          if (winOnly(h?.command)) {
            skipped.push({ what: `${label}${event} hook: ${short(String(h.command))}`, why: "runs a Windows program" });
            return false;
          }
          return true;
        }).map(({ commandWindows: _w, ...h }: any) => h),
      }))
      .filter((g: any) => g.hooks.length);
    kept += g2.reduce((n: number, g: any) => n + g.hooks.length, 0);
    if (g2.length) out[event] = g2;
  }
  return { hooks: out, kept };
}

const readJson = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
// JSONC (OpenCode): comments and trailing commas, outside strings.
function parseJsonc(text: string) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") while (i < text.length && text[i] !== "\n") i++;
    else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

// Codex's config.toml, block by block: Windows-only MCP servers (and their sub-tables) and notify go,
// everything else keeps its keys with paths mapped. Two spellings of one path become one table.
function codexToml(text: string, map: (s: string) => string, skipped: SyncReport["skipped"]): { text: string; mcp: number } {
  const blocks: { header: string | null; lines: string[] }[] = [{ header: null, lines: [] }];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) blocks.push({ header: line.trim(), lines: [line] });
    else blocks.at(-1)!.lines.push(line);
  }
  const dropped = new Set<string>();
  let mcp = 0;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks) {
    let lines = b.lines;
    if (b.header === null) {
      lines = lines.filter((l) => {
        if (/^\s*notify\s*=/.test(l) && winOnly(tomlProgram(l))) {
          skipped.push({ what: "Codex notify", why: "runs a Windows program" });
          return false;
        }
        return true;
      });
    } else {
      const m = b.header.match(/^\[mcp_servers\.("[^"]+"|'[^']+'|[^.\]]+)(\.|\])/);
      if (m) {
        const name = m[1].replace(/^["']|["']$/g, "");
        if (m[2] === "]") {
          const cmd = b.lines.find((l) => /^\s*command\s*=/.test(l)) ?? "";
          if (winOnly(tomlProgram(cmd))) {
            dropped.add(name);
            skipped.push({ what: `Codex MCP ${name}`, why: "runs a Windows program" });
          } else mcp++;
        }
        if (dropped.has(name)) continue;
      }
      const header = map(b.header);
      if (seen.has(header)) continue;
      seen.add(header);
    }
    out.push(...lines.map(map));
  }
  return { text: out.join("\n"), mcp };
}

// Everything to send from `src` (this home), shaped for a server whose home is `dest`.
export function collect(src: string, dest: string): Bundle {
  const map = homeMapper(src, dest);
  const files: Bundle["files"] = new Map();
  const skipped: SyncReport["skipped"] = [];
  const envDirs = new Set<string>();
  const counts = { claudeSkills: 0, codexSkills: 0, opencodeSkills: 0, sharedSkills: 0, plugins: 0, mcp: 0, hooks: 0 };
  const put = (rel: string, data: Buffer | string) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    files.set(rel, { data: buf, size: buf.length, mtimeMs: 0, secret: SECRET.has(rel) });
  };

  // Links are followed (many skills are links into another agent's folder) and copied as plain files;
  // a link back into a folder already being walked is not, so a loop can't run forever.
  const walk = (rel: string, seen: Set<string> = new Set()) => {
    const abs = path.join(src, rel);
    let real: string;
    let entries: fs.Dirent[];
    try {
      real = fs.realpathSync(abs);
      if (seen.has(real)) return;
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    const inside = new Set(seen).add(real);
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      const fileAbs = path.join(src, r);
      let st: fs.Stats | null = null;
      if (e.isSymbolicLink()) {
        try {
          st = fs.statSync(fileAbs);
        } catch {
          continue; // a broken link
        }
      }
      if (e.isDirectory() || st?.isDirectory()) {
        if (ENV_DIRS.has(e.name)) envDirs.add(rel);
        else if (!SKIP_DIRS.has(e.name)) walk(r, inside);
      } else if ((e.isFile() || st?.isFile()) && !NEVER.has(e.name) && !SKIP_EXT.test(e.name)) {
        const fst = st ?? fs.statSync(fileAbs);
        if (fst.size > MAX_FILE) skipped.push({ what: r, why: `too big (${Math.round(fst.size / 1048576)} MB)` });
        else files.set(r, { abs: fileAbs, size: fst.size, mtimeMs: fst.mtimeMs, secret: false });
      }
    }
  };
  for (const d of DIRS) walk(d);
  // OpenCode keeps its plugins' packages in its own folder: rebuilt there, not copied.
  if (fs.existsSync(path.join(src, ".config/opencode/node_modules"))) envDirs.add(".config/opencode");

  const exists = (rel: string) => fs.existsSync(path.join(src, rel));
  const text = (rel: string) => fs.readFileSync(path.join(src, rel), "utf8");
  // One unreadable config is reported and left out; it never stops the rest of the sync.
  const json = (rel: string, use: (j: any) => void) => {
    if (!exists(rel)) return;
    let j: any;
    try {
      j = readJson(path.join(src, rel)) ?? {};
    } catch {
      skipped.push({ what: rel, why: "couldn't be read (not valid JSON)" });
      return;
    }
    if (typeof j === "object") use(j);
  };
  for (const rel of [".claude/CLAUDE.md", ".codex/AGENTS.md", ".config/opencode/AGENTS.md", ".claude/plugins/blocklist.json"]) if (exists(rel)) put(rel, fs.readFileSync(path.join(src, rel)));
  // The home folder's rules apply to every project under it, on the server too. They often describe the
  // laptop itself (its OS, its shell), so the copy says where it now is.
  for (const rel of ["CLAUDE.md", "AGENTS.md"])
    if (exists(rel))
      put(rel, `> Copied from your laptop by Kuvend. This copy is on the server (home ${dest}): notes below about the laptop's machine don't apply here.\n\n${map(text(rel))}`);

  json(".claude/settings.json", (s) => {
    if (s.hooks) {
      const f = filterHooks(s.hooks, "", skipped);
      s.hooks = f.hooks;
      counts.hooks += f.kept;
    }
    if (s.statusLine && winOnly(s.statusLine.command)) {
      skipped.push({ what: "Claude status line", why: "runs a Windows program" });
      delete s.statusLine;
    }
    put(".claude/settings.json", JSON.stringify(mapStrings(s, map), null, 2));
  });
  json(".claude.json", (cj) => {
    const servers: Record<string, any> = {};
    for (const [name, v] of Object.entries<any>(cj.mcpServers ?? {})) {
      if (winOnly(v?.command)) skipped.push({ what: `Claude MCP ${name}`, why: "runs a Windows program" });
      else servers[name] = v;
    }
    counts.mcp += Object.keys(servers).length;
    put(MCP, JSON.stringify(mapStrings(servers, map), null, 2));
  });
  for (const rel of [".claude/plugins/installed_plugins.json", ".claude/plugins/known_marketplaces.json"])
    json(rel, (j) => {
      if (rel.endsWith("installed_plugins.json")) counts.plugins = Object.keys(j.plugins ?? {}).length;
      put(rel, JSON.stringify(mapStrings(j, map), null, 2));
    });
  if (exists(".codex/config.toml")) {
    const t = codexToml(text(".codex/config.toml"), map, skipped);
    counts.mcp += t.mcp;
    put(".codex/config.toml", t.text);
  }
  json(".codex/hooks.json", (j) => {
    const f = filterHooks(j.hooks, "Codex ", skipped);
    counts.hooks += f.kept;
    put(".codex/hooks.json", JSON.stringify(mapStrings({ ...j, hooks: f.hooks }, map), null, 2));
  });
  for (const rel of [".config/opencode/opencode.json", ".config/opencode/opencode.jsonc"]) {
    if (!exists(rel)) continue;
    try {
      const j = parseJsonc(text(rel));
      for (const [name, v] of Object.entries<any>(j.mcp ?? {})) {
        const cmd = Array.isArray(v?.command) ? v.command[0] : v?.command;
        if (v?.type === "local" && winOnly(cmd)) {
          skipped.push({ what: `OpenCode MCP ${name}`, why: "runs a Windows program" });
          delete j.mcp[name];
        } else counts.mcp++;
      }
      put(rel, JSON.stringify(mapStrings(j, map), null, 2));
    } catch {
      skipped.push({ what: rel, why: "couldn't be read, sent as written" });
      put(rel, map(text(rel)));
    }
  }

  const skillsIn = (root: string) => new Set([...files.keys()].filter((p) => p.startsWith(`${root}/`) && p.endsWith("/SKILL.md")).map((p) => p.split("/").slice(0, root.split("/").length + 1).join("/"))).size;
  counts.claudeSkills = skillsIn(".claude/skills");
  counts.codexSkills = skillsIn(".codex/skills");
  counts.opencodeSkills = skillsIn(".config/opencode/skills");
  counts.sharedSkills = skillsIn(".agents/skills");
  let bytes = 0;
  for (const f of files.values()) bytes += f.size;
  return { files, report: { at: new Date().toISOString(), files: files.size, bytes, counts, skipped, envDirs: [...envDirs].sort() } };
}

export const read = (b: Bundle, p: string): Buffer => {
  const f = b.files.get(p);
  if (!f) throw new Error(`${p} isn't in this sync`);
  return f.data ?? fs.readFileSync(f.abs!);
};

// Hashes of files on disk, remembered by size and modification time: after the first sync, a sync is
// a stat of each file. Hashing yields to the event loop now and then, so Kuvend stays responsive.
const shaCache = new Map<string, { size: number; mtimeMs: number; sha: string }>();
const sha256 = (d: Buffer) => crypto.createHash("sha256").update(d).digest("hex");
export async function manifest(b: Bundle): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  let n = 0;
  for (const [p, f] of b.files) {
    let sha: string;
    if (f.data) sha = sha256(f.data);
    else {
      const c = shaCache.get(f.abs!);
      if (c && c.size === f.size && c.mtimeMs === f.mtimeMs) sha = c.sha;
      else {
        try {
          sha = sha256(fs.readFileSync(f.abs!));
        } catch {
          b.files.delete(p); // gone since it was listed (an agent rewriting its own files): next sync has it
          continue;
        }
        shaCache.set(f.abs!, { size: f.size, mtimeMs: f.mtimeMs, sha });
        if (++n % 200 === 0) await new Promise((r) => setImmediate(r));
      }
    }
    out.push({ path: p, sha, size: f.size });
  }
  return out.sort((a, z) => a.path.localeCompare(z.path));
}

// ---------- the server side ----------

type State = { files: Record<string, string>; report: SyncReport | null };
const stateFile = () => path.join(home(), "synced.json");
function readState(): State {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return { files: s?.files && typeof s.files === "object" ? s.files : {}, report: s?.report ?? null };
  } catch {
    return { files: {}, report: null };
  }
}
function writeState(s: State) {
  fs.mkdirSync(home(), { recursive: true });
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, stateFile());
}
export const lastReport = () => readState().report;

export function allowed(p: string): boolean {
  if (typeof p !== "string" || !p || p.includes("\\") || p.startsWith("/") || /^[a-z]:/i.test(p)) return false;
  const parts = p.split("/");
  if (parts.some((x) => x === ".." || x === "." || x === "")) return false;
  if (NEVER.has(parts.at(-1)!)) return false;
  return FILES.includes(p) || DIRS.some((d) => p.startsWith(`${d}/`));
}

function writeFile(abs: string, data: Buffer, secret: boolean) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.kuvend-tmp`;
  fs.writeFileSync(tmp, data, { mode: secret ? 0o600 : 0o644 });
  fs.renameSync(tmp, abs);
  if (secret) fs.chmodSync(abs, 0o600);
}

// Which files the server lacks or has in another version.
export function plan(dest: string, list: ManifestEntry[]): string[] {
  const st = readState();
  return list.filter((e) => allowed(e.path) && (st.files[e.path] !== e.sha || (e.path !== MCP && !fs.existsSync(path.join(dest, e.path))))).map((e) => e.path);
}

// Writes the files sent. The last call of a sync carries the whole manifest: files this sync wrote
// before but the laptop no longer has are removed. Files the sync never wrote are never touched.
export function apply(dest: string, input: ApplyInput) {
  for (const f of input.files ?? []) if (!allowed(f.path)) throw new Error(`${String(f.path).slice(0, 120)} is not a synced path`);
  for (const e of input.manifest ?? []) if (!allowed(e.path)) throw new Error(`${String(e.path).slice(0, 120)} is not a synced path`);
  const st = readState();
  for (const f of input.files ?? []) {
    const data = Buffer.from(f.data, "base64");
    if (f.path === MCP) {
      const file = path.join(dest, ".claude.json");
      let own: any = {};
      try {
        own = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        /* a server that never ran Claude Code yet */
      }
      writeFile(file, Buffer.from(JSON.stringify({ ...own, mcpServers: JSON.parse(data.toString("utf8")) }, null, 2)), true);
    } else writeFile(path.join(dest, f.path), data, !!f.secret || SECRET.has(f.path));
    st.files[f.path] = crypto.createHash("sha256").update(data).digest("hex");
  }
  if (input.manifest) {
    const keep = new Set(input.manifest.map((e) => e.path));
    for (const p of Object.keys(st.files)) {
      if (keep.has(p)) continue;
      if (p !== MCP && allowed(p)) fs.rmSync(path.join(dest, p), { force: true });
      delete st.files[p];
    }
  }
  if (input.report) st.report = input.report;
  writeState(st);
}
