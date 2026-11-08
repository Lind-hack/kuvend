import { Check, Copy, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { encode } from "uqr";
import { api, type RemoteStatus } from "./api";
import { ago, Button, cx, Led } from "./ui";

// Continue on your phone. The agents stay on this computer, so the phone gets the very same session:
// its history, and every skill, MCP server, hook, project note and sign-in the agents use here.

type Code = { url: string; code: string; expiresAt: string };

// A QR code drawn as one SVG path, dark modules on a light plate so every phone camera reads it.
function Qr({ text }: { text: string }) {
  const { data, size } = encode(text, { ecc: "M", border: 2 });
  let d = "";
  data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Code to scan with your phone's camera" className="block h-auto w-full" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="var(--color-silk)" />
      <path d={d} fill="var(--color-desk)" />
    </svg>
  );
}

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-stretch overflow-hidden rounded-[7px] border border-rule bg-desk">
      <code className="min-w-0 flex-1 truncate px-3 py-2 font-mono text-[12.5px] text-silk-2">{text}</code>
      <button
        type="button"
        aria-label={done ? "Copied" : "Copy"}
        className="border-l border-rule px-2.5 text-silk-3 hover:text-silk"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          })
        }
      >
        {done ? <Check className="h-4 w-4 text-go" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
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

export function PhonePanel({ session, onClose }: { session?: string; onClose: () => void }) {
  const [st, setSt] = useState<RemoteStatus | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const close = useRef<HTMLButtonElement>(null);
  const timer = useCountdown(code?.expiresAt ?? null);

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

  const newCode = useCallback(() => act("code", async () => setCode(await api<Code>("/api/remote/code", { body: {} }))), [act]);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    api<RemoteStatus>("/api/remote")
      .then(setSt)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  // While a code is showing, notice the moment a phone pairs with it.
  useEffect(() => {
    if (!st?.on || !code) return;
    const t = setInterval(() => {
      api<RemoteStatus>("/api/remote")
        .then((next) => {
          setSt(next);
          if (!next.pairing) setCode(null); // used (or expired): the phone list shows who joined
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [st?.on, code]);

  useEffect(() => {
    if (st?.on && !code && !st.pairing && busy === null && st.devices.length === 0) void newCode();
  }, [st?.on]); // eslint-disable-line react-hooks/exhaustive-deps -- show a code once, right after turning on

  const start = (route: "auto" | "tunnel") =>
    act("start", async () => {
      setSt(await api<RemoteStatus>("/api/remote/start", { body: { route } }));
      setCode(await api<Code>("/api/remote/code", { body: {} }));
    });
  const stop = () =>
    act("stop", async () => {
      setSt(await api<RemoteStatus>("/api/remote/stop", { body: {} }));
      setCode(null);
    });
  const remove = (id: string) => act(`rm-${id}`, async () => setSt(await api<RemoteStatus>(`/api/remote/devices/${id}`, { method: "DELETE" })));

  const link = code ? `${code.url}#pair=${code.code}${session ? `&s=${session}` : ""}` : "";
  const install = error.match(/(winget install[^\n]*|brew install cloudflared)$/)?.[1];

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="phone-title">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="take-in lift relative max-h-[92dvh] w-full max-w-[440px] overflow-y-auto rounded-t-[18px] border border-rule-hi bg-panel p-5 sm:rounded-[14px] sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-rule-hi bg-panel-2" aria-hidden>
            <Smartphone className="h-[18px] w-[18px] text-silk-2" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="phone-title" className="text-[18px] font-semibold tracking-[-0.015em]">
              Continue on your phone
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-silk-2">The agents keep running on this computer, so your phone picks up the same session with every skill, MCP server, hook and sign-in.</p>
          </div>
          <button ref={close} type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-silk-2 transition-colors hover:bg-panel-3 hover:text-silk">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!st ? (
          !error && <p className="mt-6 text-[14px] text-silk-3">Checking…</p>
        ) : !st.on ? (
          <div className="mt-6">
            <Button tone="primary" className="w-full" disabled={!!busy} onClick={() => void start("auto")}>
              {busy === "start" ? "Connecting…" : "Turn on phone access"}
            </Button>
            <p className="mt-3 text-[12.5px] leading-relaxed text-silk-3">
              With Tailscale on this computer and your phone, the connection is private between your own devices. Without it, Kuvend opens a Cloudflare tunnel: an HTTPS link only your paired phone can use.
            </p>
            <button type="button" className="mt-2 text-[12.5px] text-silk-2 underline decoration-rule-hi underline-offset-4 hover:text-silk" disabled={!!busy} onClick={() => void start("tunnel")}>
              Use the Cloudflare tunnel even if Tailscale is on
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <p className="flex items-center gap-2 text-[13px] text-silk-2">
              <Led color="var(--color-go)" label="Phone access is on" />
              {st.route === "tailscale" ? "Private, through Tailscale" : "Through a Cloudflare tunnel"}
              <span className="ml-auto truncate font-mono text-[11.5px] text-silk-3">{st.url?.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
            </p>

            {code ? (
              <div className="mt-4 grid grid-cols-[minmax(0,152px)_minmax(0,1fr)] items-center gap-4">
                <div className="overflow-hidden rounded-[10px] p-0">
                  <Qr text={link} />
                </div>
                <div className="min-w-0 text-[13px] leading-relaxed text-silk-2">
                  <p className="font-medium text-silk">Scan with your phone's camera.</p>
                  <p className="mt-1">{session ? "It opens this session." : "It opens Kuvend."} The code works once{timer ? `, for ${timer.label}` : ""}.</p>
                  {st.route === "tailscale" && <p className="mt-1 text-silk-3">Your phone needs the Tailscale app, signed in to the same account.</p>}
                </div>
              </div>
            ) : (
              <Button className="mt-4 w-full" disabled={!!busy} onClick={() => void newCode()}>
                {busy === "code" ? "Making a code…" : st.devices.length ? "Pair another phone" : "Show a pairing code"}
              </Button>
            )}
            {code && timer?.left === 0 && (
              <Button size="sm" tone="quiet" className="mt-2" onClick={() => void newCode()}>
                That code expired. Show a new one
              </Button>
            )}
            {code && <div className="mt-3"><CopyLine text={link} /></div>}

            {st.devices.length > 0 && (
              <div className="mt-5">
                <p className="silk mb-1.5">Paired phones</p>
                <ul className="divide-y divide-rule rounded-[10px] border border-rule">
                  {st.devices.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
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

            <p className="mt-5 text-[12.5px] leading-relaxed text-silk-3">Keep this computer on and plugged in. Kuvend stops it from sleeping while phone access is on, but closing a laptop lid may still put it to sleep.</p>
            <Button tone="quiet" size="sm" className="mt-3 -ml-2.5" disabled={!!busy} onClick={() => void stop()}>
              {busy === "stop" ? "Turning off…" : "Turn off phone access"}
            </Button>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-[10px] border border-clip/40 bg-clip/[0.06] p-3 text-[13px] leading-relaxed text-silk">
            {error.replace(install ?? "\u0000", "").trim()}
            {install && <div className="mt-2"><CopyLine text={install} /></div>}
          </div>
        )}
      </div>
    </div>
  );
}

// The button that opens it: on the computer only. On a phone, Kuvend is already where you are.
export function PhoneButton({ session, className, label }: { session?: string; className?: string; label?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" tone="quiet" className={cx(className)} onClick={() => setOpen(true)} aria-label="Continue on your phone" title="Continue on your phone" icon={<Smartphone className="h-4 w-4" />}>
        {label ? "Continue on phone" : null}
      </Button>
      {open && <PhonePanel session={session} onClose={() => setOpen(false)} />}
    </>
  );
}
