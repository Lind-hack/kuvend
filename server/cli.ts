import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { listChats } from "./chats.js";
import { keptRoute, startRemote, stopRemote } from "./remote.js";
import { stopAll } from "./runapp.js";
import { createServer, requestHandler } from "./server.js";
import { accessToken, readRunning, writeRunning } from "./store.js";

// kuvend [folder]            start Kuvend on this computer and open it in your browser
// kuvend serve               run it on a server that stays on: no browser, remote access always on
// kuvend code                show a code to pair a phone or a laptop with the Kuvend running here
// kuvend handoff [--to name] open the terminal chat you're in inside Kuvend (and your phone), or send it on

const argv = process.argv.slice(2);
const sub = ["serve", "code", "handoff"].includes(argv[0]) ? argv[0] : null;
const args = sub ? argv.slice(1) : argv;
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag("--help") || flag("-h")) {
  console.log(`kuvend [folder] [--port 4777] [--no-open]
    Opens a workspace for Claude Code and Codex in your browser.

kuvend serve [--port 4777] [--route tailscale|tunnel|auto]
    For a server that stays on (a VPS, a spare PC): no browser, and phone and laptop access stay on,
    so your chats keep going when your laptop is off.

kuvend code
    Shows a code to pair a phone or a laptop with the Kuvend running on this machine.

kuvend handoff [--agent claude|codex] [--to <computer>]
    Opens the newest Claude Code or Codex chat in this folder inside Kuvend, with its whole context.
    --to sends it on to a connected computer (your server), to continue there with the laptop off.`);
  process.exit(0);
}

function open(url: string) {
  if (process.platform === "win32") execFile("cmd", ["/c", "start", "", url.replace(/&/g, "^&")]);
  else execFile(process.platform === "darwin" ? "open" : "xdg-open", [url]);
}

// ---------- talking to the Kuvend already running here ----------

async function local<T>(p: string, body?: unknown): Promise<T> {
  const r = readRunning();
  if (!r) throw new Error("Kuvend isn't running. Start it first: npx kuvend");
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${r.port}${p}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", "x-kuvend-token": accessToken() }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Kuvend isn't running. Start it first: npx kuvend");
  }
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(j?.error ?? `Kuvend said ${res.status}`);
  return j as T;
}

async function code() {
  const c = await local<{ url: string; short: string; expiresAt: string }>("/api/remote/code", {});
  console.log(`\n  Pair a phone or laptop with this Kuvend\n\n  Address   ${c.url}\n  Code      ${c.short}\n\n  On a phone: open the address (Tailscale on, same account) and type the code.\n  On a laptop: Kuvend > Your server > Connect, then the address and the code.\n  The code works once, for 10 minutes.\n`);
}

async function handoffCmd() {
  const cwd = path.resolve(process.cwd()).toLowerCase();
  const want = value("--agent");
  const chat = (await listChats(200)).find((c) => path.resolve(c.cwd).toLowerCase() === cwd && (!want || c.agent === want));
  if (!chat) throw new Error(`No ${want ?? "Claude Code or Codex"} chat found for this folder (${process.cwd()}).`);
  const { id } = await local<{ id: string }>("/api/chats/import", { agent: chat.agent, id: chat.id });
  const port = readRunning()!.port;
  const to = value("--to");
  if (to) {
    const { peers } = await local<{ peers: { id: string; name: string }[] }>("/api/peers");
    const p = peers.find((x) => x.name.toLowerCase() === to.toLowerCase() || x.id === to) ?? (peers.length === 1 && to === "server" ? peers[0] : undefined);
    if (!p) throw new Error(`No connected computer called "${to}". Connected: ${peers.map((x) => x.name).join(", ") || "none yet (Kuvend > Your server)"}.`);
    const s = await local<{ sentTo: { url: string; name: string } }>(`/api/sessions/${id}/send-to`, { peer: p.id });
    console.log(`\n  Sent "${chat.title}" to ${s.sentTo.name}. It continues there, with your laptop off too.\n\n  ${s.sentTo.url}\n\n  Stop using this chat in the terminal: it now lives on ${s.sentTo.name}. Bring it back from Kuvend.\n`);
    return;
  }
  const url = `http://127.0.0.1:${port}/#/s/${id}`;
  console.log(`\n  "${chat.title}" is open in Kuvend, with its whole history.\n\n  ${url}\n\n  On your phone, open Kuvend: it's in the list. Close this terminal chat so only one place writes to it.\n`);
  if (!flag("--no-open")) open(`http://127.0.0.1:${port}/?s=${id}#token=${accessToken()}`);
}

if (sub === "code" || sub === "handoff") {
  (sub === "code" ? code() : handoffCmd()).catch((e) => {
    console.error(`\n  ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  });
} else {
  // A port you asked for is used or reported; the default moves up a few ports when it's taken.
  const chosen = value("--port") ?? process.env.KUVEND_PORT;
  const port = Number(chosen ?? 4777);
  const folderArg = sub ? undefined : args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
  const project = folderArg ? path.resolve(folderArg) : undefined;
  if (project && !fs.existsSync(project)) {
    console.error(`No such folder: ${project}`);
    process.exit(1);
  }
  const serve = sub === "serve";

  const listen = (at: number, triesLeft: number) => {
    const server = createServer(at);
    server.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE" && !chosen && triesLeft > 0) return listen(at + 1, triesLeft - 1);
      console.error(e.code === "EADDRINUSE" ? `Port ${at} is busy. Close the program using it, or start Kuvend with --port ${at + 1}.` : e.message);
      process.exit(1);
    });
    server.listen(at, "127.0.0.1", async () => {
      writeRunning(at);
      const url = `http://127.0.0.1:${at}/${project ? `?project=${encodeURIComponent(project)}` : ""}#token=${accessToken()}`;
      const moved = at !== port ? `  (Port ${port} was busy, so Kuvend is on ${at}. A paired phone needs port ${port}: free it and restart.)\n\n` : "";
      // Phone access you left on comes back on; a server always has it on.
      const route = serve ? ((value("--route") as "auto" | "tailscale" | "tunnel" | undefined) ?? keptRoute() ?? "auto") : keptRoute();
      let remoteLine = "";
      if (route) {
        try {
          const st = await startRemote(at, requestHandler(), route, { awake: !serve });
          remoteLine = `  Remote access is on: ${st.url}\n${serve ? "  Pair a phone or your laptop: kuvend code\n" : ""}\n`;
        } catch (e) {
          remoteLine = `  Remote access couldn't start: ${e instanceof Error ? e.message : e}\n\n`;
        }
      }
      if (serve) console.log(`\n  Kuvend is serving.\n\n${moved}${remoteLine}  Keep it running (a systemd service does that for you; see the README).\n`);
      else console.log(`\n  Kuvend is running.\n\n${moved}  ${url}\n\n${remoteLine}  Keep this window open. Ctrl+C stops it.\n`);
      if (!serve && !flag("--no-open")) open(url);
    });
  };
  listen(port, 10);

  const quit = () => {
    stopAll();
    stopRemote(false); // closes the route and lets the computer sleep; it comes back on next start
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}
