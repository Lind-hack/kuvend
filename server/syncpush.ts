import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { peerCall } from "./handoff.js";
import { home, readPeers, type Peer } from "./store.js";
import { collect, manifest, read, type SyncReport } from "./sync.js";

// The laptop's side of the config sync: push to every connected server, after a change and once an hour.
// The server's side is sync.ts plan/apply behind /api/sync/*.

export type PushStatus = { at: string; ok: boolean; sent?: number; error?: string; report?: SyncReport };
const statusFile = () => path.join(home(), "sync-push.json");
const CHUNK = 10 * 1024 * 1024; // raw bytes per request (base64 makes it ~13 MB)

export function pushStatus(): Record<string, PushStatus> {
  try {
    return JSON.parse(fs.readFileSync(statusFile(), "utf8")) ?? {};
  } catch {
    return {};
  }
}
function saveStatus(peer: string, s: PushStatus) {
  const all = { ...pushStatus(), [peer]: s };
  fs.writeFileSync(statusFile(), JSON.stringify(all, null, 2));
}

const servers = () => readPeers().filter((p) => (p.role ?? "server") === "server");

export async function pushConfig(peer: Peer): Promise<PushStatus> {
  try {
    const remote = await peerCall<{ home: string }>(peer, "/api/sync");
    if (!remote?.home) throw new Error("That Kuvend is too old to receive your setup. Update it there.");
    const b = collect(os.homedir(), remote.home);
    let list = await manifest(b);
    const { need } = await peerCall<{ need: string[] }>(peer, "/api/sync/plan", { body: { manifest: list } });
    let batch: { path: string; data: string; secret: boolean }[] = [];
    let size = 0;
    let sent = 0;
    const flush = async (final: boolean) => {
      await peerCall(peer, "/api/sync/apply", { body: { files: batch, ...(final ? { manifest: list, report: b.report } : {}) } });
      sent += batch.length;
      batch = [];
      size = 0;
    };
    for (const p of need) {
      let data: Buffer;
      try {
        data = read(b, p);
      } catch {
        list = list.filter((e) => e.path !== p); // gone since it was listed: the next sync sends it
        continue;
      }
      if (batch.length && size + data.length > CHUNK) await flush(false);
      batch.push({ path: p, data: data.toString("base64"), secret: b.files.get(p)!.secret });
      size += data.length;
    }
    await flush(true);
    const st = { at: new Date().toISOString(), ok: true, sent, report: b.report };
    saveStatus(peer.id, st);
    return st;
  } catch (e) {
    const st = { at: new Date().toISOString(), ok: false, error: e instanceof Error ? e.message : String(e) };
    saveStatus(peer.id, st);
    return st;
  }
}

let running: Promise<Record<string, PushStatus>> | null = null;
export function pushAll(): Promise<Record<string, PushStatus>> {
  // One sync at a time; a change during a sync is picked up by the next one.
  running ??= (async () => {
    const out: Record<string, PushStatus> = {};
    for (const p of servers()) out[p.name] = await pushConfig(p);
    return out;
  })().finally(() => (running = null));
  return running;
}

// What counts as a change: only the synced parts of each folder (Claude Code writes chat history and
// caches under ~/.claude all the time; those must not start a sync).
const WATCH: [string, RegExp][] = [
  [".claude", /^(skills|agents|commands|rules|output-styles|hooks|statusline|plugins[\\/](cache|marketplaces|installed_plugins\.json|known_marketplaces\.json|blocklist\.json))([\\/]|$)|^(CLAUDE\.md|settings\.json)$/],
  [".codex", /^(skills|prompts|rules|scripts)([\\/]|$)|^(AGENTS\.md|config\.toml|hooks\.json)$/],
  [path.join(".config", "opencode"), /^(skills|plugins|agents?|commands?)([\\/]|$)|^(opencode\.jsonc?|AGENTS\.md)$/],
  [path.join(".agents", "skills"), /./],
];

export function startConfigSync() {
  let timer: NodeJS.Timeout | null = null;
  const soon = (ms = 60_000) => {
    if (!servers().length) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void pushAll(), ms);
  };
  for (const [dir, relevant] of WATCH) {
    try {
      fs.watch(path.join(os.homedir(), dir), { recursive: true, persistent: false }, (_e, name) => {
        if (name && relevant.test(String(name))) soon();
      });
    } catch {
      /* that agent isn't installed here */
    }
  }
  soon(30_000); // at start
  setInterval(() => soon(0), 60 * 60_000).unref(); // and hourly (MCP servers live in ~/.claude.json, which changes constantly)
}
