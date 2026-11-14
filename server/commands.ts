import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeSlash } from "./agents.js";
import type { AgentId } from "./store.js";

// What the / menu offers for each agent: the skills and custom commands that agent's CLI reads on the
// computer Kuvend runs on (after a sync, the same as the laptop's), plus the built-ins that work in a
// headless run. Picking one just types "/name": the CLI runs it itself, exactly as in a terminal.

export type Command = { name: string; description: string; kind: "skill" | "command" | "builtin" };

const BUILTIN: Record<AgentId, Command[]> = {
  claude: [
    { name: "compact", description: "Summarize the conversation so far to free up context", kind: "builtin" },
    { name: "goal", description: "Set the goal Claude keeps working toward", kind: "builtin" },
  ],
  codex: [{ name: "review", description: "Codex reviews the uncommitted changes (or: /review --base main)", kind: "builtin" }],
  opencode: [],
};

// The frontmatter's name and description, including YAML's folded (>-) and literal (|) blocks.
function front(text: string): { name?: string; description?: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][-+]?$/.test(v)) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      v = block.join(" ");
    }
    out[kv[1]] = v.replace(/^["']|["']$/g, "");
  }
  return out;
}

const read = (f: string) => {
  try {
    return fs.readFileSync(f, "utf8");
  } catch {
    return "";
  }
};
const dirs = (d: string) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
};
const firstLine = (text: string) => text.replace(/^---[\s\S]*?---\s*/, "").split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 140) ?? "";

// A skill folder is often a link into another agent's folder: follow it.
const isDir = (dir: string, e: fs.Dirent) => {
  if (e.isDirectory()) return true;
  if (!e.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(dir, e.name)).isDirectory();
  } catch {
    return false;
  }
};

function skills(dir: string, prefix = ""): Command[] {
  return dirs(dir)
    .filter((e) => isDir(dir, e))
    .flatMap((e) => {
      const text = read(path.join(dir, e.name, "SKILL.md"));
      if (!text) return [];
      const f = front(text);
      return [{ name: `${prefix}${f.name || e.name}`, description: (f.description ?? "").slice(0, 200), kind: "skill" as const }];
    });
}

// Markdown commands; a sub-folder becomes a namespace (git/ship.md → git:ship).
function commands(dir: string, prefix = ""): Command[] {
  return dirs(dir).flatMap((e) => {
    if (isDir(dir, e)) return commands(path.join(dir, e.name), `${prefix}${e.name}:`);
    if (!e.name.endsWith(".md")) return [];
    const text = read(path.join(dir, e.name));
    return [{ name: `${prefix}${e.name.slice(0, -3)}`, description: (front(text).description ?? firstLine(text)).slice(0, 200), kind: "command" as const }];
  });
}

function claudeCommands(home: string): Command[] {
  let settings: any = {};
  try {
    settings = JSON.parse(read(path.join(home, ".claude", "settings.json")) || "{}");
  } catch {
    /* none */
  }
  const off = new Set(Object.entries(settings.skillOverrides ?? {}).filter(([, v]) => v === "off").map(([k]) => k));
  const plugins: Command[] = [];
  try {
    const installed = JSON.parse(read(path.join(home, ".claude", "plugins", "installed_plugins.json")) || "{}").plugins ?? {};
    for (const [id, entries] of Object.entries<any>(installed)) {
      if (settings.enabledPlugins?.[id] === false) continue;
      const at = Array.isArray(entries) ? entries.at(-1)?.installPath : null;
      if (typeof at === "string") plugins.push(...skills(path.join(at, "skills"), `${id.split("@")[0]}:`), ...commands(path.join(at, "commands"), `${id.split("@")[0]}:`));
    }
  } catch {
    /* no plugins */
  }
  return [...skills(path.join(home, ".claude", "skills")), ...commands(path.join(home, ".claude", "commands")), ...plugins].filter((c) => !off.has(c.name));
}

export function listCommands(agent: AgentId, home = os.homedir()): Command[] {
  const own =
    agent === "claude"
      ? claudeCommands(home)
      : agent === "codex"
        ? [...skills(path.join(home, ".codex", "skills")), ...skills(path.join(home, ".agents", "skills")), ...commands(path.join(home, ".codex", "prompts"), "prompts:")]
        : [
            ...skills(path.join(home, ".config", "opencode", "skills")),
            ...skills(path.join(home, ".agents", "skills")),
            ...skills(path.join(home, ".claude", "skills")),
            ...commands(path.join(home, ".config", "opencode", "command")),
            ...commands(path.join(home, ".config", "opencode", "commands")),
          ];
  // Built-ins Claude Code reported on its last run (from its start-up event), after the described ones.
  const reported: Command[] = agent === "claude" ? claudeSlash.map((name) => ({ name, description: "", kind: "builtin" as const })) : [];
  const seen = new Set<string>();
  return [...BUILTIN[agent], ...own, ...reported].filter((c) => !seen.has(c.name) && seen.add(c.name)).sort((a, z) => (a.kind === "builtin" ? -1 : z.kind === "builtin" ? 1 : a.name.localeCompare(z.name)));
}
