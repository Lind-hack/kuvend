import { useCallback, useEffect, useState } from "react";
import { api, onPhone, pairFromHash, pairPhone, token, type AppState } from "./api";
import { Launch } from "./Launch";
import { Workspace } from "./Workspace";
import { cx, Led } from "./ui";

// Which screen: the launch screen, or one session (#/s/<id> keeps it across reloads).
const sessionFromHash = () => location.hash.match(/^#\/s\/(s[a-z0-9]+)$/)?.[1] ?? null;

// A phone that just scanned the computer's code: trade it for this phone's key, then open the session.
function Pairing({ code, session }: { code: string; session: string | null }) {
  const [error, setError] = useState("");
  useEffect(() => {
    pairPhone(code)
      .then(() => location.replace(`${location.pathname}${session ? `#/s/${session}` : "#"}`))
      .then(() => location.reload())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code, session]);
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 p-8">
      <span className="flex h-6 items-end gap-[3px]" aria-hidden>
        <span className="h-2.5 w-[5px] rounded-[1px] bg-go" />
        <span className="h-4 w-[5px] rounded-[1px] bg-warn" />
        <span className="h-6 w-[5px] rounded-[1px] bg-clip" />
      </span>
      <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{error ? "This phone isn't paired yet." : "Pairing this phone…"}</h1>
      <p className="text-[15px] leading-relaxed text-silk-2">{error || "Your computer keeps running the agents. This phone picks up the same session, with every skill, MCP server and hook."}</p>
    </div>
  );
}

export function App() {
  const pairing = pairFromHash();
  if (pairing) return <Pairing code={pairing.code} session={pairing.session} />;
  return <Main />;
}

function Main() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState<string | null>(sessionFromHash);
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
    return () => removeEventListener("hashchange", onHash);
  }, [refresh]);

  const open = (id: string | null) => {
    location.hash = id ? `/s/${id}` : "";
    setSession(id);
    refresh();
  };

  return (
    <div className="min-h-dvh">
      <header className={cx("sticky top-0 z-10 h-[49px] items-center gap-3 border-b border-rule bg-desk px-4 sm:px-5", session ? "hidden" : "flex")}>
        <button type="button" onClick={() => open(null)} className="flex items-center gap-2.5" aria-label="Kuvend, back to projects">
          <span className="flex h-5 items-end gap-[2px]" aria-hidden>
            <span className="h-2 w-[4px] rounded-[1px] bg-go" />
            <span className="h-3.5 w-[4px] rounded-[1px] bg-warn" />
            <span className="h-5 w-[4px] rounded-[1px] bg-clip" />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.01em]">Kuvend</span>
        </button>
        <span className="ml-auto flex items-center gap-2 text-[12.5px] text-silk-3">
          <Led on={!error && !!state} color={error ? "var(--color-clip)" : "var(--color-go)"} />
          {error ? "not connected" : state ? (onPhone ? "on your phone" : "local") : "connecting"}
        </span>
      </header>

      {!token ? (
        <div className="mx-auto max-w-lg p-10 text-[15px] text-silk-2">
          {onPhone ? (
            <>
              <p className="mb-2 text-[20px] font-semibold text-silk">Pair this phone first.</p>
              On your computer, open Kuvend, choose Continue on phone, and scan the code with this phone's camera.
            </>
          ) : (
            <>
              <p className="mb-2 text-[20px] font-semibold text-silk">Open Kuvend from your terminal.</p>
              Run <code className="font-mono text-silk">npx kuvend</code> and use the link it prints. The link carries a key that keeps other websites away from your agents.
            </>
          )}
        </div>
      ) : error && !state ? (
        <div className="mx-auto max-w-lg p-10 text-[15px] text-silk-2">
          <p className="mb-2 text-[20px] font-semibold text-silk">Can't reach Kuvend.</p>
          {error}
        </div>
      ) : session ? (
        <Workspace key={session} id={session} state={state} onOpen={open} onHome={() => open(null)} refreshState={refresh} />
      ) : (
        <Launch state={state} onOpen={open} initialProject={initialProject} />
      )}
    </div>
  );
}
