import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, onPhone, pairFromHash, pairPhone, standalone, token, type AppState } from "./api";
import { Backdrop } from "./Backdrop";
import { Launch, Settings } from "./Launch";
import { PhonePanel, ServerPanel } from "./Phone";
import { Sidebar, type Sheet } from "./Sidebar";
import { Button, cx, Mark } from "./ui";
import { Workspace } from "./Workspace";

// Which screen: home, or one chat (#/s/<id> keeps it across reloads; ?s=<id> opens one from the terminal).
const sessionFromHash = () => location.hash.match(/^#\/s\/(s[a-z0-9]+)$/)?.[1] ?? null;
{
  const s = new URLSearchParams(location.search).get("s");
  if (s && /^s[a-z0-9]+$/.test(s)) history.replaceState(null, "", `${location.pathname}#/s/${s}`);
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] place-items-center px-6 py-12">
      <div className="rise flex w-full max-w-[420px] flex-col gap-4">{children}</div>
    </div>
  );
}

// A phone that just scanned the computer's code: trade it for this phone's key, then open the session.
function Pairing({ code, session }: { code: string; session: string | null }) {
  const [error, setError] = useState("");
  useEffect(() => {
    pairPhone(code)
      .then(() => location.replace(`${location.pathname}${session ? `#/s/${session}` : "#"}`))
      .then(() => location.reload())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code, session]);
  if (error) return <PairByCode note={error} />;
  return (
    <Center>
      <Mark className="h-8 w-8" />
      <h1 className="display text-[40px]">Pairing this phone…</h1>
      <p className="text-[15px] leading-relaxed text-silk-2">Your computer keeps running the agents. This phone picks up the same chats, with every skill, MCP server and hook.</p>
    </Center>
  );
}

// No key yet on this phone (a home-screen app on an iPhone starts with empty storage): type the short code.
function PairByCode({ note }: { note?: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(note ?? "");
  const ready = code.replace(/[^a-z0-9]/gi, "").length === 8;
  async function go() {
    setBusy(true);
    setError("");
    try {
      await pairPhone(code);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <Center>
      <Mark className="h-8 w-8" />
      <h1 className="display text-[44px]">Pair this phone.</h1>
      <p className="text-[15px] leading-relaxed text-silk-2">
        On your computer, open Kuvend and choose <span className="text-silk">Phone</span>. Type the short code shown under the QR. You do this once{standalone ? " for this home-screen app" : ""}.
      </p>
      <form
        className="glass mt-2 flex items-center gap-2 rounded-[20px] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void go();
        }}
      >
        <label htmlFor="pair-code" className="sr-only">
          Pairing code
        </label>
        <input
          id="pair-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9))}
          placeholder="ABCD-EFGH"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          className="min-h-12 w-0 min-w-0 flex-1 bg-transparent px-3 font-mono text-[22px] tracking-[0.18em] outline-none placeholder:text-silk-3/50"
        />
        <Button tone="primary" type="submit" disabled={!ready || busy} icon={busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : undefined}>
          Pair
        </Button>
      </form>
      {error && <p className="text-[14px] text-clip">{error}</p>}
      <p className="text-[12.5px] text-silk-3">Your phone needs Tailscale on, signed in to the same account as the computer. Or scan the QR with the camera.</p>
    </Center>
  );
}

export function App() {
  const pairing = pairFromHash();
  const [inChat, setInChat] = useState(() => !!sessionFromHash());
  useEffect(() => {
    const on = () => setInChat(!!sessionFromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return (
    <>
      <Backdrop dim={inChat} />
      {pairing ? <Pairing code={pairing.code} session={pairing.session} /> : !token ? onPhone ? <PairByCode /> : <OpenFromTerminal /> : <Main />}
    </>
  );
}

function OpenFromTerminal() {
  return (
    <Center>
      <Mark className="h-8 w-8" />
      <h1 className="display text-[44px]">Open Kuvend from your terminal.</h1>
      <p className="text-[15px] leading-relaxed text-silk-2">
        Run <code className="rounded-[6px] bg-white/[0.07] px-1.5 py-0.5 font-mono text-[13px] text-silk">npx kuvend</code> and use the link it opens. The link carries a key that keeps other websites away from your agents.
      </p>
    </Center>
  );
}

function Main() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState<string | null>(sessionFromHash);
  const [navOpen, setNavOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [running, setRunning] = useState(false);
  const initialProject = new URLSearchParams(location.search).get("project") ?? undefined;

  const refresh = useCallback(() => {
    api<AppState>("/api/state")
      .then((s) => {
        setState(s);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const onHash = () => setSession(sessionFromHash());
    addEventListener("hashchange", onHash);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(refresh, 20_000);
    return () => {
      removeEventListener("hashchange", onHash);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
    };
  }, [refresh]);

  const open = (id: string | null) => {
    location.hash = id ? `/s/${id}` : "";
    setSession(id);
    setNavOpen(false);
    refresh();
  };

  if (error && !state)
    return (
      <Center>
        <Mark className="h-8 w-8" />
        <h1 className="display text-[44px]">Can't reach Kuvend.</h1>
        <p className="text-[15px] leading-relaxed text-silk-2">{error}</p>
        <Button className="self-start" onClick={refresh}>
          Try again
        </Button>
      </Center>
    );

  return (
    <div className="grid h-dvh min-h-0 grid-cols-1 lg:grid-cols-[272px_minmax(0,1fr)]">
      <aside className={cx("glass-quiet min-h-0 lg:m-2 lg:mr-0 lg:rounded-[18px] max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-[88vw] max-lg:max-w-[340px] max-lg:bg-panel/95 max-lg:pt-[env(safe-area-inset-top)] max-lg:transition-transform max-lg:duration-[420ms] max-lg:ease-[var(--ease-spring)]", !navOpen && "max-lg:-translate-x-[105%]")}>
        <Sidebar state={state} current={session} currentRunning={running} onOpen={(id) => open(id)} onHome={() => open(null)} onSheet={(s) => (setNavOpen(false), setSheet(s))} onClose={navOpen ? () => setNavOpen(false) : undefined} />
      </aside>
      {navOpen && <button type="button" aria-label="Close" className="fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px] lg:hidden" onClick={() => setNavOpen(false)} />}

      <div className="min-h-0 min-w-0">
        {session ? (
          <Workspace key={session} id={session} state={state} onOpen={open} onHome={() => open(null)} refreshState={refresh} onNav={() => setNavOpen(true)} onRunning={setRunning} onSheet={setSheet} />
        ) : (
          <Launch state={state} onOpen={open} initialProject={initialProject} onNav={() => setNavOpen(true)} onSheet={setSheet} />
        )}
      </div>

      {sheet === "phone" && <PhonePanel session={session ?? undefined} onClose={() => setSheet(null)} />}
      {sheet === "server" && <ServerPanel onClose={() => setSheet(null)} onOpen={open} />}
      {sheet === "settings" && <Settings state={state} onClose={() => setSheet(null)} />}
    </div>
  );
}
