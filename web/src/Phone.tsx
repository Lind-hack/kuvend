import { ExternalLink, LoaderCircle, Server, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { encode } from "uqr";
import { api, type AppState, type PairCode, type Peer, type RemoteStatus } from "./api";
import { CopyLine } from "./Launch";
import { AgentDot, ago, Button, Led, Sheet } from "./ui";

// Continue on your phone. The agents stay on this computer, so the phone gets the very same chats:
// their history, and every skill, MCP server, hook, project note and sign-in the agents use here.

function Qr({ text }: { text: string }) {
  const { data, size } = encode(text, { ecc: "M", border: 2 });
  let d = "";
  data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Code to scan with your phone's camera" className="block h-auto w-full" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#f4f1ec" />
      <path d={d} fill="#07080c" />
    </svg>
  );
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const s = Math.max(0, Math.round((Date.parse(until) - now) / 1000));
  return { left: s, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
}

// The QR (for the camera) and the short code (for a home-screen app, which keeps its own storage).
export function CodeCard({ code, session, onNew }: { code: PairCode; session?: string; onNew: () => void }) {
  const timer = useCountdown(code.expiresAt);
  const link = `${code.url}#pair=${code.code}${session ? `&s=${session}` : ""}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,148px)_minmax(0,1fr)] items-center gap-5">
        <div className="overflow-hidden rounded-[14px] shadow-[0_10px_30px_-12px_rgb(0_0_0/0.8)]">
          <Qr text={link} />
        </div>
        <div className="min-w-0 text-[13.5px] leading-relaxed text-silk-2">
          <p className="font-medium text-silk">Scan with your phone's camera.</p>
          <p className="mt-1">Or, in the home-screen app, type</p>
          <p className="mt-1.5 font-mono text-[24px] tracking-[0.14em] text-dawn select-all">{code.short}</p>
          <p className="mt-1 text-[12.5px] text-silk-3">Works once{timer ? `, for ${timer.label}` : ""}.</p>
        </div>
      </div>
      {timer?.left === 0 && (
        <Button size="sm" tone="plain" className="self-start" onClick={onNew}>
          That code expired. Show a new one
        </Button>
      )}
      <CopyLine text={link} />
    </div>
  );
}

// The connected servers (machines that stay on), if any.
function useServers() {
  const [servers, setServers] = useState<Peer[] | null>(null);
  useEffect(() => {
    api<{ peers: Peer[] }>("/api/peers")
      .then((r) => setServers(r.peers.filter((p) => p.role === "server")))
      .catch(() => setServers([]));
  }, []);
  return servers;
}

// A phone paired with this laptop can only reach it while the laptop is on. A phone paired with the
// server works always: the server's app shows its own chats, the copies of this laptop's chats (to
// continue with the laptop off), and, while the laptop is on, the laptop's live chats too.
function PairWithServer({ servers }: { servers: Peer[] | null }) {
  const [code, setCode] = useState<{ peer: string; code: PairCode } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (servers === null) return null;
  if (servers.length === 0)
    return (
      <div className="mb-5 rounded-[14px] bg-white/[0.03] p-3.5 text-[13px] leading-relaxed text-silk-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
        <p>
          <span className="text-silk">With this laptop off, your phone has nothing to connect to.</span> Kuvend and the agents run on this laptop, so when it's off or asleep, the phone can't open anything. To keep going with it off, run Kuvend on a machine that stays on (a VPS, a spare PC) and connect it under <span className="text-silk">Server</span>. Then pair your phone with the server here.
        </p>
      </div>
    );
  const pair = async (p: Peer) => {
    setBusy(p.id);
    setError("");
    try {
      setCode({ peer: p.id, code: await api<PairCode>(`/api/peers/${p.id}/code`, { body: {} }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  };
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-rule pb-6">
      <p className="text-[14px] leading-relaxed text-silk-2">
        <span className="font-medium text-silk">Works with this laptop off:</span> pair your phone with your server. Its app shows this laptop's chats live while the laptop is on, and its copies of them, ready to continue, while it's off.
      </p>
      {code ? (
        <CodeCard code={code.code} onNew={() => void pair(servers.find((p) => p.id === code.peer)!)} />
      ) : (
        servers.map((p) => (
          <Button key={p.id} tone="primary" className="w-full" disabled={!!busy} onClick={() => void pair(p)} icon={busy === p.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}>
            Pair your phone with {p.name}
          </Button>
        ))
      )}
      <p className="text-[12.5px] leading-relaxed text-silk-3">Already paired your phone with this laptop? Pair it with the server instead and use that one: remove the old home-screen app and add the server's.</p>
      {error && <p className="text-[13px] text-clip">{error}</p>}
    </div>
  );
}

export function PhonePanel({ session, onClose }: { session?: string; onClose: () => void }) {
  const [st, setSt] = useState<RemoteStatus | null>(null);
  const [code, setCode] = useState<PairCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const servers = useServers();

  const act = useCallback(async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);
  const newCode = useCallback(() => act("code", async () => setCode(await api<PairCode>("/api/remote/code", { body: {} }))), [act]);

  // A code for this laptop shows up by itself only when there's no server to pair with instead.
  const noServer = servers?.length === 0;
  useEffect(() => {
    if (servers === null) return;
    api<RemoteStatus>("/api/remote")
      .then((s) => {
        setSt(s);
        if (s.on && s.devices.length === 0 && noServer) void newCode();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [newCode, servers === null, noServer]);

  // While a code is showing, notice the moment a phone pairs with it.
  useEffect(() => {
    if (!st?.on || !code) return;
    const t = setInterval(() => {
      api<RemoteStatus>("/api/remote")
        .then((next) => {
          setSt(next);
          if (!next.pairing) setCode(null);
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [st?.on, code]);

  const start = (route: "auto" | "tunnel") =>
    act("start", async () => {
      setSt(await api<RemoteStatus>("/api/remote/start", { body: { route } }));
      setCode(await api<PairCode>("/api/remote/code", { body: {} }));
    });
  const stop = () =>
    act("stop", async () => {
      setSt(await api<RemoteStatus>("/api/remote/stop", { body: {} }));
      setCode(null);
    });
  const remove = (id: string) => act(`rm-${id}`, async () => setSt(await api<RemoteStatus>(`/api/remote/devices/${id}`, { method: "DELETE" })));
  const install = error.match(/(winget install[^\n]*|brew install cloudflared)$/)?.[1];

  return (
    <Sheet title="Your phone" icon={<Smartphone className="h-[18px] w-[18px]" />} onClose={onClose}>
      <PairWithServer servers={servers} />
      <p className="text-[14px] leading-relaxed text-silk-2">{servers?.length ? "Or pair with this computer. That works only while it's on: the agents run here, with every skill, MCP server, hook and sign-in." : "The agents keep running on this computer, so your phone picks up the same chats with every skill, MCP server, hook and sign-in."}</p>
      {!st ? (
        !error && <LoaderCircle className="mt-6 h-4 w-4 animate-spin text-silk-3" aria-label="Checking" />
      ) : !st.on ? (
        <div className="mt-6 flex flex-col gap-3">
          <Button tone={servers?.length ? "plain" : "primary"} className="w-full" disabled={!!busy} onClick={() => void start("auto")} icon={busy === "start" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : undefined}>
            {busy === "start" ? "Connecting…" : "Turn on phone access"}
          </Button>
          <p className="text-[12.5px] leading-relaxed text-silk-3">With Tailscale on this computer and your phone, the connection is private between your own devices. Without it, Kuvend opens a Cloudflare tunnel: an HTTPS link only a paired phone can use.</p>
          <button type="button" className="self-start text-[12.5px] text-silk-2 underline decoration-white/20 underline-offset-4 hover:text-silk" disabled={!!busy} onClick={() => void start("tunnel")}>
            Use the Cloudflare tunnel even if Tailscale is on
          </button>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-5">
          <p className="flex items-center gap-2 text-[13px] text-silk-2">
            <Led color="var(--color-go)" label="Phone access is on" />
            {st.route === "tailscale" ? "Private, through Tailscale" : "Through a Cloudflare tunnel"}
            <span className="ml-auto truncate font-mono text-[11.5px] text-silk-3">{st.url?.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
          </p>
          {code ? (
            <CodeCard code={code} session={session} onNew={() => void newCode()} />
          ) : (
            <Button tone="plain" className="w-full" disabled={!!busy} onClick={() => void newCode()}>
              {busy === "code" ? "Making a code…" : st.devices.length ? "Pair another phone" : "Show a pairing code"}
            </Button>
          )}
          {st.devices.length > 0 && (
            <div>
              <p className="silk mb-1.5">Paired</p>
              <ul className="plate divide-y divide-rule rounded-[14px]">
                {st.devices.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <Smartphone className="h-4 w-4 shrink-0 text-silk-3" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{d.name}</span>
                      <span className="block text-[12px] text-silk-3">{d.lastSeenAt ? `Last seen ${ago(d.lastSeenAt)}` : `Paired ${ago(d.createdAt)}`}</span>
                    </span>
                    <Button size="sm" tone="danger" disabled={!!busy} onClick={() => void remove(d.id)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[12.5px] leading-relaxed text-silk-3">Phone access stays on, also after Kuvend restarts, until you turn it off. Keep this computer on and plugged in; Kuvend stops it from sleeping, but closing a laptop lid may still put it to sleep. For chats that go on with the laptop off, connect a server.</p>
          <Button tone="quiet" size="sm" className="-ml-3 self-start" disabled={!!busy} onClick={() => void stop()}>
            {busy === "stop" ? "Turning off…" : "Turn off phone access"}
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-[14px] bg-clip/[0.08] p-3 text-[13px] leading-relaxed text-silk shadow-[inset_0_0_0_1px_rgb(240_106_85/0.35)]">
          {error.replace(install ?? "\u0000", "").trim()}
          {install && (
            <div className="mt-2">
              <CopyLine text={install} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---------- a server that stays on ----------

type PeerState = { sessions: AppState["sessions"]; machine: string };

function PeerCard({ peer, onRemoved, onError }: { peer: Peer; onRemoved: () => void; onError: (e: string) => void }) {
  const [state, setState] = useState<PeerState | null | "down">(null);
  const [code, setCode] = useState<PairCode | null>(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    api<PeerState>(`/api/peers/${peer.id}/state`)
      .then(setState)
      .catch(() => setState("down"));
  }, [peer.id]);
  useEffect(load, [load]);
  const pairPhone = async () => {
    setBusy("code");
    try {
      setCode(await api<PairCode>(`/api/peers/${peer.id}/code`, { body: {} }));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  };
  return (
    <li className="plate flex flex-col gap-3 rounded-[16px] p-4">
      <div className="flex items-center gap-3">
        <Server className="h-4 w-4 shrink-0 text-silk-2" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{peer.name}</span>
          <span className="block truncate font-mono text-[11.5px] text-silk-3">{peer.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
        </span>
        {state === null ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-silk-3" aria-label="Checking" /> : <Led color={state === "down" ? "var(--color-clip)" : "var(--color-go)"} label={state === "down" ? "Not reachable" : "Online"} />}
      </div>
      {state === "down" && <p className="text-[12.5px] text-silk-3">Not reachable right now. Is Kuvend running there, and is this computer on Tailscale?</p>}
      {state && state !== "down" && state.sessions.length > 0 && (
        <ul className="flex flex-col">
          {state.sessions.slice(0, 5).map((s) => (
            <li key={s.id}>
              <a href={`${peer.url}#/s/${s.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[13.5px] text-silk-2 hover:bg-white/[0.05] hover:text-silk">
                <AgentDot agent={s.agent} />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                {s.running && <Led color="var(--color-dawn)" blink label="Working" />}
                <span className="shrink-0 text-[11.5px] text-silk-3">{ago(s.updatedAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {code ? (
        <CodeCard code={code} onNew={() => void pairPhone()} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <a href={peer.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[13px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] hover:bg-white/[0.1]">
            Open <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <Button size="sm" tone="plain" disabled={!!busy || state === "down"} onClick={() => void pairPhone()} icon={busy === "code" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5" />}>
            Pair your phone with it
          </Button>
          <Button size="sm" tone="quiet" onClick={() => void api(`/api/peers/${peer.id}`, { method: "DELETE" }).then(onRemoved).catch((e) => onError(String(e?.message ?? e)))}>
            Disconnect
          </Button>
        </div>
      )}
    </li>
  );
}

export function ServerPanel({ onClose }: { onClose: () => void; onOpen?: (id: string) => void }) {
  const [peers, setPeers] = useState<Peer[] | null>(null);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<{ peers: Peer[] }>("/api/peers")
      .then((r) => setPeers(r.peers))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      setPeers((await api<{ peers: Peer[] }>("/api/peers", { body: { url, code } })).peers);
      setUrl("");
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }
  const field = "min-h-11 min-w-0 rounded-[12px] bg-black/25 px-3 text-[14px] outline-none shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] placeholder:text-silk-3 focus:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]";
  return (
    <Sheet title="Your server" icon={<Server className="h-[18px] w-[18px]" />} onClose={onClose} wide>
      <p className="text-[14px] leading-relaxed text-silk-2">Keep chats going with this computer off. Run Kuvend on a machine that stays on (a VPS, a spare PC), then send any chat there: its history, its context and your code, uncommitted work included. Bring it back whenever you like.</p>
      {peers && peers.length > 0 && (
        <ul className="mt-5 flex flex-col gap-3">
          {peers.map((p) => (
            <PeerCard key={p.id} peer={p} onRemoved={load} onError={setError} />
          ))}
        </ul>
      )}
      <form
        className="mt-5 flex flex-col gap-2.5 border-t border-rule pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim() && code.trim()) void connect();
        }}
      >
        <h3 className="text-[15px] font-medium">{peers?.length ? "Connect another" : "Connect your server"}</h3>
        <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-silk-3">
          <li>
            On the server: <code className="font-mono text-silk-2">npx kuvend serve</code> (Tailscale on, same account)
          </li>
          <li>
            Then there: <code className="font-mono text-silk-2">npx kuvend code</code>, and type its address and code here
          </li>
        </ol>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
          <label className="sr-only" htmlFor="peer-url">
            Server address
          </label>
          <input id="peer-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://my-server.tailnet.ts.net:4777" className={`${field} font-mono text-[12.5px]`} />
          <label className="sr-only" htmlFor="peer-code">
            Code
          </label>
          <input id="peer-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" className={`${field} font-mono tracking-[0.1em]`} />
        </div>
        <Button tone="primary" type="submit" className="self-start" disabled={busy || !url.trim() || !code.trim()} icon={busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : undefined}>
          Connect
        </Button>
      </form>
      {error && <p className="mt-3 text-[13px] text-clip">{error}</p>}
    </Sheet>
  );
}

// Send one chat to a connected server, to continue there with this computer off.
export function SendToServer({ session, onClose, onSent }: { session: string; onClose: () => void; onSent: () => void }) {
  const [peers, setPeers] = useState<Peer[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ peers: Peer[] }>("/api/peers")
      .then((r) => setPeers(r.peers))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  async function send(p: Peer) {
    setBusy(p.id);
    setError("");
    try {
      await api(`/api/sessions/${session}/send-to`, { body: { peer: p.id } });
      onSent();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  }
  return (
    <Sheet title="Continue on your server" icon={<Server className="h-[18px] w-[18px]" />} onClose={onClose}>
      <p className="text-[14px] leading-relaxed text-silk-2">The chat, its history and your code (uncommitted work too, never .env files) go to the server, which picks up the same conversation. This copy pauses until you bring it back. A chat started in your home folder sends only the conversation.</p>
      {peers === null ? (
        !error && <LoaderCircle className="mt-5 h-4 w-4 animate-spin text-silk-3" aria-label="Loading" />
      ) : peers.length === 0 ? (
        <p className="mt-5 text-[14px] text-silk-3">No server connected yet. Choose Server in the sidebar to connect one.</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {peers.map((p) => (
            <li key={p.id}>
              <button type="button" disabled={!!busy} onClick={() => void send(p)} className="plate flex w-full items-center gap-3 rounded-[14px] px-4 py-3 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-50">
                <Server className="h-4 w-4 text-silk-2" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{p.name}</span>
                  <span className="block truncate font-mono text-[11.5px] text-silk-3">{p.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                </span>
                {busy === p.id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-label="Sending" /> : <span className="text-[13px] text-dawn">Send</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="shimmer mt-3 text-[13px]">Packing the chat and your code. A big project takes a minute.</p>}
      {error && <p className="mt-3 text-[13px] text-clip">{error}</p>}
    </Sheet>
  );
}
