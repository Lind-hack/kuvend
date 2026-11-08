import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { killTree, run, start } from "./proc.js";
import { home } from "./store.js";

// Continue on your phone. The agents keep running on this computer (that is what keeps every skill,
// MCP server, hook, project note and login exactly the same); the phone only drives Kuvend's page.
//
// - A route to the phone: Tailscale when it's running (a private, encrypted network between your own
//   devices, nothing public), else a Cloudflare quick tunnel (an HTTPS link, no account).
// - Pairing: the laptop shows a one-time code as a QR. It works once, for ten minutes, and dies after
//   a handful of wrong guesses. Pairing gives the phone its own key, stored here only as a hash and
//   revocable from the laptop.
// - Over a remote route only a paired phone's key is accepted, never this install's own key, and only
//   the laptop itself can start or stop phone access, show a code, or remove a phone.
// - While phone access is on, the computer is kept from going to sleep.

export class RemoteError extends Error {}

export type Route = "tailscale" | "tunnel";
type Device = { id: string; name: string; hash: string; createdAt: string; lastSeenAt?: string };
type Pairing = { hash: string; shortHash: string; expires: number; tries: number };

const PAIR_TTL = 10 * 60_000;
const PAIR_TRIES = 8;
const devicesFile = () => path.join(home(), "devices.json");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const st: {
  route: Route | null;
  url: string | null;
  hosts: Set<string>;
  listener: http.Server | null;
  tunnel: ChildProcess | null;
  awake: ChildProcess | null;
  pairing: Pairing | null;
} = { route: null, url: null, hosts: new Set(), listener: null, tunnel: null, awake: null, pairing: null };

// ---------- paired phones ----------

function readDevices(): Device[] {
  try {
    const v = JSON.parse(fs.readFileSync(devicesFile(), "utf8"));
    return Array.isArray(v) ? v.filter((d) => typeof d?.id === "string" && typeof d?.hash === "string") : [];
  } catch {
    return [];
  }
}
function writeDevices(list: Device[]) {
  fs.mkdirSync(home(), { recursive: true });
  const tmp = `${devicesFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, devicesFile());
}

export const devices = () => readDevices().map(({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, lastSeenAt: lastSeenAt ?? null }));

export function removeDevice(id: string) {
  const list = readDevices();
  if (!list.some((d) => d.id === id)) throw new RemoteError("No such phone");
  writeDevices(list.filter((d) => d.id !== id));
  cut(id);
}

// Is this a paired phone's key? Marks it seen (at most once a minute, to spare the disk).
export function deviceFor(token: string): string | null {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const h = sha(token);
  const list = readDevices();
  const d = list.find((x) => same(x.hash, h));
  if (!d) return null;
  if (!d.lastSeenAt || Date.now() - Date.parse(d.lastSeenAt) > 60_000) {
    d.lastSeenAt = new Date().toISOString();
    writeDevices(list);
  }
  return d.id;
}

// A phone's open live-update streams, so removing the phone or turning phone access off cuts them
// at once instead of letting an open stream keep showing the session.
const streams = new Set<{ device: string; end: () => void }>();
export function trackStream(device: string, end: () => void): () => void {
  const s = { device, end };
  streams.add(s);
  return () => streams.delete(s);
}
function cut(device?: string) {
  for (const s of [...streams]) {
    if (device && s.device !== device) continue;
    streams.delete(s);
    s.end();
  }
}

// ---------- pairing ----------

// Two forms of one code: a long one inside the QR, and a short one to type. A home-screen app on an
// iPhone keeps its own storage, apart from Safari, so it pairs by typing the short code once.
const SHORT = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const normalShort = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function newPairingCode(): { code: string; short: string; expiresAt: string } {
  const code = crypto.randomBytes(16).toString("hex");
  const raw = Array.from(crypto.randomBytes(8), (b) => SHORT[b % SHORT.length]).join("");
  st.pairing = { hash: sha(code), shortHash: sha(raw), expires: Date.now() + PAIR_TTL, tries: 0 };
  return { code, short: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: new Date(st.pairing.expires).toISOString() };
}

export function pair(code: string, name: string): { token: string; id: string } {
  const p = st.pairing;
  if (!p || Date.now() > p.expires) {
    st.pairing = null;
    throw new RemoteError("This code has expired. Show a new one on your computer.");
  }
  const short = normalShort(code);
  const ok = /^[a-f0-9]{32}$/.test(code) ? same(sha(code), p.hash) : short.length === 8 && same(sha(short), p.shortHash);
  if (!ok) {
    if (++p.tries >= PAIR_TRIES) st.pairing = null;
    throw new RemoteError("That code doesn't match. Check the code on your computer and try again.");
  }
  st.pairing = null; // one phone per code
  const token = crypto.randomBytes(24).toString("hex");
  const id = `d${crypto.randomBytes(5).toString("hex")}`;
  const clean = name.replace(/[^\p{L}\p{N} .,'()-]/gu, "").trim().slice(0, 40) || "Phone";
  writeDevices([...readDevices(), { id, name: clean, hash: sha(token), createdAt: new Date().toISOString() }]);
  return { token, id };
}

// ---------- which Host headers are this machine's remote routes ----------

export const isRemoteHost = (host: string) => st.hosts.has(host.toLowerCase());

export function status() {
  return {
    on: st.route !== null,
    route: st.route,
    url: st.url,
    pairing: st.pairing && Date.now() < st.pairing.expires ? { expiresAt: new Date(st.pairing.expires).toISOString() } : null,
    kept: keptRoute() !== null,
    devices: devices(),
  };
}

// ---------- routes ----------

type Tailnet = { ip: string; dns: string | null };

async function tailnet(): Promise<Tailnet | null> {
  const bins = process.platform === "win32" ? ["tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe"] : process.platform === "darwin" ? ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"] : ["tailscale"];
  for (const bin of bins) {
    const r = await run(bin, ["status", "--json"], { timeoutMs: 8000 });
    if (!r.ok) continue;
    try {
      const j = JSON.parse(r.out);
      const ip = (j?.Self?.TailscaleIPs as string[] | undefined)?.find((a) => /^100\.\d+\.\d+\.\d+$/.test(a));
      if (j?.BackendState !== "Running" || !ip) return null;
      const dns = typeof j.Self.DNSName === "string" && j.Self.DNSName ? j.Self.DNSName.replace(/\.$/, "") : null;
      return { ip, dns };
    } catch {
      return null;
    }
  }
  return null;
}

async function viaTailscale(port: number, handler: http.RequestListener, t: Tailnet) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, t.ip, () => resolve());
  });
  st.listener = server;
  st.hosts = new Set([`${t.ip}:${port}`, ...(t.dns ? [`${t.dns}:${port}`, `${t.dns.split(".")[0]}:${port}`] : [])].map((h) => h.toLowerCase()));
  st.url = `http://${t.dns ?? t.ip}:${port}/`;
  st.route = "tailscale";
}

function cloudflaredBin(): string {
  const local = process.platform === "win32" ? ["C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"] : ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"];
  return local.find((p) => fs.existsSync(p)) ?? "cloudflared";
}

export const CLOUDFLARED_INSTALL =
  process.platform === "win32" ? "winget install --id Cloudflare.cloudflared" : process.platform === "darwin" ? "brew install cloudflared" : "See developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads";

async function viaTunnel(port: number) {
  const child = start(cloudflaredBin(), ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new RemoteError("The Cloudflare tunnel didn't come up within 30 seconds. Check your internet connection and try again.")), 30_000);
    const read = (d: Buffer) => {
      log = (log + d.toString("utf8")).slice(-8000);
      const m = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new RemoteError(e.code === "ENOENT" ? `To reach your phone without Tailscale, Kuvend uses Cloudflare's free tunnel. Install it once: ${CLOUDFLARED_INSTALL}` : e.message));
    });
    child.on("exit", () => {
      clearTimeout(timer);
      reject(new RemoteError("The Cloudflare tunnel stopped before it was ready."));
    });
  }).catch((e) => {
    killTree(child);
    throw e;
  });
  child.removeAllListeners("exit");
  child.on("exit", () => {
    // The tunnel died on its own: phone access is off until it's started again.
    if (st.tunnel === child) {
      st.tunnel = null;
      clear();
    }
  });
  st.tunnel = child;
  st.hosts = new Set([new URL(url).host.toLowerCase()]);
  st.url = `${url}/`;
  st.route = "tunnel";
}

// Keep the computer awake while a phone may be driving it. The screen may still turn off.
function keepAwake() {
  if (st.awake) return;
  if (process.platform === "win32") {
    const ps =
      'Add-Type -Name P -Namespace K -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);\'; [K.P]::SetThreadExecutionState(0x80000001) | Out-Null; while ($true) { Start-Sleep -Seconds 60; [K.P]::SetThreadExecutionState(0x80000001) | Out-Null }';
    st.awake = start("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" });
  } else if (process.platform === "darwin") {
    st.awake = start("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  } else {
    st.awake = start("systemd-inhibit", ["--what=idle:sleep", "--who=Kuvend", "--why=Phone access is on", "sleep", "infinity"], { stdio: "ignore" });
  }
  st.awake.on("error", () => (st.awake = null)); // not available on this system: carry on without it
}

function clear() {
  st.route = null;
  st.url = null;
  st.hosts = new Set();
  st.pairing = null;
  cut();
  if (st.listener) {
    st.listener.close();
    st.listener.closeAllConnections(); // close() alone leaves open keep-alive and streaming sockets
  }
  st.listener = null;
  killTree(st.awake ?? undefined);
  st.awake = null;
}

// Phone access stays on across restarts until you turn it off: a paired phone's home-screen app just
// works whenever Kuvend runs. (A Tailscale address stays the same; a quick tunnel gets a new one.)
const keepFile = () => path.join(home(), "remote.json");
export function keptRoute(): "auto" | Route | null {
  try {
    const v = JSON.parse(fs.readFileSync(keepFile(), "utf8"))?.route;
    return v === "auto" || v === "tailscale" || v === "tunnel" ? v : null;
  } catch {
    return null;
  }
}
function keep(route: "auto" | Route | null) {
  if (route) fs.writeFileSync(keepFile(), JSON.stringify({ route }), { mode: 0o600 });
  else fs.rmSync(keepFile(), { force: true });
}

export async function startRemote(port: number, handler: http.RequestListener, want: "auto" | Route = "auto", opts: { awake?: boolean } = {}) {
  if (st.route) return status();
  const t = want === "tunnel" ? null : await tailnet();
  if (want === "tailscale" && !t) throw new RemoteError("Tailscale isn't running on this computer. Open Tailscale and sign in, or use the Cloudflare tunnel.");
  if (t) await viaTailscale(port, handler, t);
  else await viaTunnel(port);
  if (opts.awake !== false) keepAwake(); // a server never sleeps anyway
  keep(want);
  return status();
}

// `forget`: you turned it off. Quitting Kuvend leaves it remembered, so it comes back on next start.
export function stopRemote(forget = true) {
  killTree(st.tunnel ?? undefined);
  st.tunnel = null;
  clear();
  if (forget) keep(null);
  return status();
}

// Tests only: pretend a phone route is up on these Host names, without Tailscale or a tunnel.
export const __test = {
  route(hosts: string[]) {
    st.hosts = new Set(hosts.map((h) => h.toLowerCase()));
    st.route = "tunnel";
    st.url = `https://${hosts[0]}/`;
  },
  expirePairing() {
    if (st.pairing) st.pairing.expires = Date.now() - 1;
  },
};
