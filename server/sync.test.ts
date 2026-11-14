import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.KUVEND_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-home-"));
const sync = await import("./sync.js");

const put = (root: string, rel: string, data: string | object) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 2));
};

// A laptop home with the setup to copy, and things that must never leave it.
function laptop() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-src-"));
  const win = src.replace(/\//g, "\\"); // how Windows writes this home in configs
  put(src, ".claude/skills/tdd/SKILL.md", "---\nname: tdd\ndescription: Test first\n---\nRed, green, refactor.");
  put(src, ".claude/skills/seo/SKILL.md", "---\nname: seo\n---\n");
  put(src, ".claude/skills/seo/.venv/Lib/site.py", "x");
  put(src, ".claude/skills/seo/ms-playwright/chrome.exe", "x");
  put(src, ".claude/skills/web/node_modules/dep/index.js", "x");
  put(src, ".claude/skills/web/SKILL.md", "---\nname: web\n---\n");
  put(src, ".claude/agents/scout.md", "scout");
  put(src, ".claude/CLAUDE.md", "# Lind's rules");
  put(src, ".claude/hooks/check.mjs", "console.log(1)");
  put(src, ".claude/settings.json", {
    model: "opus",
    permissions: { allow: ["Bash(npm test)"] },
    statusLine: { type: "command", command: `node "${src}/.claude/statusline/bar.mjs"` },
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "C:/Users/PC1/.orca/agent-hooks/orca-agent-hook.exe claude" }] }],
      PostToolUse: [
        { matcher: "*", hooks: [{ type: "command", command: "C:/Users/PC1/.orca/agent-hooks/orca-agent-hook.exe claude" }] },
        { matcher: "Edit", hooks: [{ type: "command", command: `node "${win}\\.claude\\hooks\\check.mjs"`, commandWindows: "cmd /c x" }] },
      ],
    },
  });
  put(src, ".claude.json", {
    numStartups: 9,
    oauthAccount: { email: "secret@example.com" },
    mcpServers: {
      context7: { type: "http", url: "https://mcp.context7.com/mcp", headers: { Authorization: "Bearer k-123" } },
      nanobanana: { type: "stdio", command: "npx", args: ["-y", "nanobanana"], env: { GEMINI_API_KEY: "g-456" } },
      rea: { type: "stdio", command: `${win}\\Documents\\rea\\node.exe`, args: [] },
    },
  });
  put(src, ".claude/.credentials.json", { token: "never" });
  put(src, ".claude/projects/C--x/abc.jsonl", "chat history");
  put(src, ".claude/plugins/installed_plugins.json", { version: 2, plugins: { "figma@x": [{ installPath: `${win}\\.claude\\plugins\\cache\\x\\figma\\1.0` }] } });
  put(src, ".claude/plugins/cache/x/figma/1.0/plugin.json", "{}");
  put(src, ".claude/plugins/marketplaces/x/.git/HEAD", "ref");
  put(src, ".codex/skills/tdd/SKILL.md", "---\nname: tdd\n---\n");
  put(src, ".codex/AGENTS.md", "Codex rules");
  put(src, ".codex/auth.json", { tokens: "never" });
  put(src, ".codex/sessions/2026/11/14/rollout-x.jsonl", "history");
  put(
    src,
    ".codex/config.toml",
    [
      'model = "gpt-5.6-sol"',
      'notify = [ "C:\\\\Users\\\\PC1\\\\AppData\\\\codex-computer-use.exe", "turn-ended" ]',
      "",
      "[mcp_servers.node_repl]",
      "command = 'C:\\Users\\PC1\\AppData\\node_repl.exe'",
      "[mcp_servers.node_repl.env]",
      "X = '1'",
      "",
      "[mcp_servers.firecrawl]",
      'command = "npx"',
      'args = ["-y", "firecrawl-mcp"]',
      "[mcp_servers.firecrawl.env]",
      'FIRECRAWL_API_KEY = "fc-789"',
      "",
      "[hooks.state.'" + win + "\\.codex\\hooks.json:stop:2:0']",
      "trusted = true",
      "[hooks.state.'" + win.replace(/\\/g, "/") + "/.codex/hooks.json:stop:2:0']",
      "trusted = true",
      "",
      "[projects.'" + win + "\\Desktop\\claude']",
      'trust_level = "trusted"',
    ].join("\n"),
  );
  put(src, ".config/opencode/opencode.jsonc", '{\n  // my setup\n  "mcp": { "rea": { "type": "local", "command": ["C:\\\\x\\\\node.exe"] }, "ctx": { "type": "remote", "url": "https://x" } },\n}\n');
  put(src, ".config/opencode/node_modules/x/i.js", "x");
  put(src, ".agents/skills/impeccable/scripts/hook.mjs", "hook");
  // Skills shared between agents are often links into another agent's folder.
  put(src, ".codex/skills/ask-matt/SKILL.md", "---\nname: ask-matt\n---\nAsk.");
  fs.symlinkSync(path.join(src, ".codex/skills/ask-matt"), path.join(src, ".claude/skills/ask-matt"), process.platform === "win32" ? "junction" : "dir");
  fs.symlinkSync(path.join(src, ".claude/skills"), path.join(src, ".claude/skills/loop"), process.platform === "win32" ? "junction" : "dir");
  return { src, win };
}

test("collect: the setup goes, credentials, history, environments and Windows-only commands stay", () => {
  const { src } = laptop();
  const b = sync.collect(src, "/home/kuvend");
  const paths = [...b.files.keys()].sort();
  for (const p of [".claude/skills/tdd/SKILL.md", ".claude/agents/scout.md", ".claude/CLAUDE.md", ".claude/hooks/check.mjs", ".claude/settings.json", ".claude.json#mcpServers", ".claude/plugins/installed_plugins.json", ".claude/plugins/cache/x/figma/1.0/plugin.json", ".codex/skills/tdd/SKILL.md", ".codex/AGENTS.md", ".codex/config.toml", ".config/opencode/opencode.jsonc", ".agents/skills/impeccable/scripts/hook.mjs"])
    assert.ok(paths.includes(p), `sends ${p}`);
  assert.ok(paths.includes(".claude/skills/ask-matt/SKILL.md"), "a linked skill is copied as files");
  assert.ok(!paths.some((p) => p.startsWith(".claude/skills/loop/")), "a link that loops back is not followed");
  for (const bad of [".credentials.json", "projects/", "auth.json", "sessions/", ".venv", "ms-playwright", "node_modules", ".git/"]) assert.ok(!paths.some((p) => p.includes(bad)), `never sends ${bad}`);
  assert.deepEqual(b.report.envDirs, [".claude/skills/seo", ".claude/skills/web", ".config/opencode"], "what needs its environment rebuilt on the server is named");

  const settings = JSON.parse(sync.read(b, ".claude/settings.json").toString());
  assert.equal(settings.hooks.SessionStart, undefined, "a group left empty disappears");
  assert.equal(settings.hooks.PostToolUse.length, 1);
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].command, 'node "/home/kuvend/.claude/hooks/check.mjs"', "a portable hook is kept, its paths mapped");
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].commandWindows, undefined);
  assert.equal(settings.statusLine.command, 'node "/home/kuvend/.claude/statusline/bar.mjs"');
  assert.deepEqual(settings.permissions, { allow: ["Bash(npm test)"] });

  const mcp = JSON.parse(sync.read(b, ".claude.json#mcpServers").toString());
  assert.deepEqual(Object.keys(mcp).sort(), ["context7", "nanobanana"], "only user MCP servers, Windows-only ones left out");
  assert.equal(mcp.nanobanana.env.GEMINI_API_KEY, "g-456", "with their keys (Lind chose that)");
  assert.ok(b.files.get(".claude.json#mcpServers")!.secret);
  assert.ok(!sync.read(b, ".claude.json#mcpServers").toString().includes("secret@example.com"), "nothing else from .claude.json");

  const toml = sync.read(b, ".codex/config.toml").toString();
  assert.match(toml, /\[mcp_servers\.firecrawl\][\s\S]*FIRECRAWL_API_KEY = "fc-789"/);
  assert.doesNotMatch(toml, /node_repl|notify|\.exe/, "Windows-only servers and notify are dropped");
  assert.equal((toml.match(/\[hooks\.state\.'\/home\/kuvend\/\.codex\/hooks\.json:stop:2:0'\]/g) ?? []).length, 1, "hook trust is kept for the server's path, once");
  assert.match(toml, /\[projects\.'\/home\/kuvend\/Desktop\/claude'\]/, "paths point at the server's home");

  const oc = sync.read(b, ".config/opencode/opencode.jsonc").toString();
  assert.deepEqual(Object.keys(JSON.parse(oc).mcp), ["ctx"]);

  const plugins = JSON.parse(sync.read(b, ".claude/plugins/installed_plugins.json").toString());
  assert.equal(plugins.plugins["figma@x"][0].installPath, "/home/kuvend/.claude/plugins/cache/x/figma/1.0");

  assert.equal(b.report.counts.claudeSkills, 4);
  assert.equal(b.report.counts.codexSkills, 2);
  assert.equal(b.report.counts.mcp, 4, "two Claude servers, one Codex server, one OpenCode server");
  const skipped = b.report.skipped.map((s) => s.what).join(" | ");
  for (const w of ["SessionStart hook", "PostToolUse hook", "Claude MCP rea", "Codex MCP node_repl", "Codex notify", "OpenCode MCP rea"]) assert.ok(skipped.includes(w), `reports ${w}`);
});

test("apply: only what changed travels, MCP servers merge into the server's own file, removed files go", async () => {
  const { src } = laptop();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-dest-"));
  put(dest, ".claude.json", { numStartups: 1, userID: "server", mcpServers: { old: { command: "npx" } } });
  put(dest, ".claude/skills/server-own/SKILL.md", "made on the server");

  let b = sync.collect(src, dest);
  let need = sync.plan(dest, (await sync.manifest(b)));
  assert.equal(need.length, b.files.size, "first time: everything");
  sync.apply(dest, { files: need.map((p) => ({ path: p, data: sync.read(b, p).toString("base64"), secret: b.files.get(p)!.secret })), manifest: (await sync.manifest(b)), report: b.report });

  assert.equal(fs.readFileSync(path.join(dest, ".claude/skills/tdd/SKILL.md"), "utf8"), "---\nname: tdd\ndescription: Test first\n---\nRed, green, refactor.");
  const cj = JSON.parse(fs.readFileSync(path.join(dest, ".claude.json"), "utf8"));
  assert.equal(cj.userID, "server", "the server's own state stays");
  assert.deepEqual(Object.keys(cj.mcpServers).sort(), ["context7", "nanobanana"], "MCP servers are the laptop's");
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dest, ".claude/settings.json")).mode & 0o777, 0o600, "files with keys are private");

  assert.deepEqual(sync.plan(dest, (await sync.manifest(sync.collect(src, dest)))), [], "nothing changed: nothing travels");

  fs.rmSync(path.join(src, ".claude/agents/scout.md"));
  fs.writeFileSync(path.join(src, ".claude/CLAUDE.md"), "# new rules");
  b = sync.collect(src, dest);
  need = sync.plan(dest, (await sync.manifest(b)));
  assert.deepEqual(need, [".claude/CLAUDE.md"]);
  sync.apply(dest, { files: need.map((p) => ({ path: p, data: sync.read(b, p).toString("base64"), secret: false })), manifest: (await sync.manifest(b)), report: b.report });
  assert.ok(!fs.existsSync(path.join(dest, ".claude/agents/scout.md")), "a file removed on the laptop goes from the server");
  assert.ok(fs.existsSync(path.join(dest, ".claude/skills/server-own/SKILL.md")), "files the sync never wrote are left alone");
  assert.equal(sync.lastReport()?.counts.claudeSkills, 4);
});

test("review fixes: PowerShell/cmd as a TOML value is Windows-only, and one unreadable file doesn't stop the sync", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-src-"));
  put(src, ".codex/config.toml", ['notify = ["powershell", "-File", "n.ps"]', "[mcp_servers.win]", 'command = "cmd"', 'args = ["/c", "x"]', "[mcp_servers.ok]", 'command = "npx"'].join("\n"));
  put(src, ".claude.json", "null");
  put(src, ".claude/plugins/installed_plugins.json", "{ not json");
  put(src, ".claude/settings.json", "null");
  put(src, ".claude/skills/a/SKILL.md", "---\nname: a\n---\n");
  const b = sync.collect(src, "/home/kuvend");
  const toml = sync.read(b, ".codex/config.toml").toString();
  assert.doesNotMatch(toml, /notify|mcp_servers\.win/);
  assert.match(toml, /mcp_servers\.ok/);
  assert.ok(b.files.has(".claude/skills/a/SKILL.md"), "the rest still goes");
  const why = b.report.skipped.map((s) => s.what).join(" | ");
  assert.match(why, /installed_plugins\.json/);
});

test("files Codex manages itself stay, and a file that vanishes mid-sync is left out, not fatal", async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-src-"));
  put(src, ".codex/skills/.system/openai-docs/SKILL.md", "codex's own");
  put(src, ".codex/skills/mine/SKILL.md", "---\nname: mine\n---\n");
  put(src, ".codex/skills/mine/gone.md", "about to vanish");
  const b = sync.collect(src, "/home/kuvend");
  assert.ok(![...b.files.keys()].some((p) => p.includes(".system")), "Codex's built-in skills are its own business");
  fs.rmSync(path.join(src, ".codex/skills/mine/gone.md"));
  const list = await sync.manifest(b);
  assert.ok(!list.some((e) => e.path.endsWith("gone.md")), "a vanished file drops out of the manifest");
  assert.ok(list.some((e) => e.path.endsWith("mine/SKILL.md")));
});

test("the home folder's CLAUDE.md (rules for every project under it) goes too, marked as the server's copy", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-src-"));
  put(src, "CLAUDE.md", `# Rules\n- Machine: Windows 11.\n- Projects live in ${src}\\Desktop\\claude.`);
  const b = sync.collect(src, "/home/kuvend");
  const text = sync.read(b, "CLAUDE.md").toString();
  assert.match(text, /^> Copied from your laptop by Kuvend\. This copy is on the server/);
  assert.match(text, /Projects live in \/home\/kuvend\/Desktop\/claude\./, "paths point at the server's home");
  assert.ok(sync.allowed("CLAUDE.md") && sync.allowed("AGENTS.md"));
});

test("apply refuses paths outside the synced folders", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "kuvend-dest-"));
  const bad = (p: string) => assert.throws(() => sync.apply(dest, { files: [{ path: p, data: "eA==", secret: false }], manifest: [{ path: p, sha: "x", size: 1 }], report: null }), /not a synced/, p);
  bad("../evil");
  bad(".claude/../../evil");
  bad(".bashrc");
  bad(".ssh/authorized_keys");
  bad(".claude/.credentials.json");
  bad("/etc/passwd");
});
