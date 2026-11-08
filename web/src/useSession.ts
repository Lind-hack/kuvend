import { useCallback, useEffect, useRef, useState } from "react";
import { api, events, type Project, type RunState, type Session, type Turn } from "./api";

type Loaded = { session: Session; running: boolean; delta: string; run: RunState; project: Project | null };

// One session, kept live: the saved record, the streaming text of the running turn, and the app's output.
export function useSession(id: string | null) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const deltaTurn = useRef<string | null>(null);
  // A phone puts the page to sleep in the background and drops its live stream: coming back (or back
  // online) reconnects and re-reads, so the chat is never stale.
  const [wake, setWake] = useState(0);
  useEffect(() => {
    let hidden = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") hidden = Date.now();
      else if (Date.now() - hidden > 2000) setWake((w) => w + 1);
    };
    const onOnline = () => setWake((w) => w + 1);
    document.addEventListener("visibilitychange", onVis);
    addEventListener("online", onOnline);
    addEventListener("pageshow", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      removeEventListener("online", onOnline);
      removeEventListener("pageshow", onOnline);
    };
  }, []);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api<Loaded>(`/api/sessions/${id}`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (shown.current !== id) setData(null); // a reconnect keeps what's on screen
    shown.current = id;
    if (!id) return;
    void reload();
    return events(id, (m) => {
      if (m.type === "run") return setData((d) => (d ? { ...d, run: m.state } : d));
      if (m.type === "delta") {
        deltaTurn.current = m.turn;
        return setData((d) => (d ? { ...d, delta: d.delta + m.text, running: true } : d));
      }
      setData((d) => {
        if (!d) return d;
        const turns = upsert(d.session.turns, m.turn);
        // A finished text item replaces the streamed text it was built from.
        const lastText = [...m.turn.items].reverse().find((i) => i.kind === "text");
        const delta = m.ended || (lastText && deltaTurn.current === m.turn.id && d.delta && lastText.text.startsWith(d.delta.slice(0, 40))) ? "" : d.delta;
        return { ...d, session: { ...d.session, turns }, running: m.ended ? false : m.turn.status === "running" || d.running, delta };
      });
      if (m.ended) void reload();
    });
  }, [id, reload, wake]);

  // The live stream can miss a frame (a reconnect, a sleeping laptop). While a take runs, re-read the
  // record every few seconds, and once more when it stops, so the page never stays stale.
  const running = !!data?.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void reload(), 4000);
    return () => {
      clearInterval(t);
      void reload();
    };
  }, [running, reload]);

  return { data, error, reload, setData };
}

function upsert(turns: Turn[], t: Turn): Turn[] {
  const i = turns.findIndex((x) => x.id === t.id);
  if (i < 0) return [...turns, t];
  const next = turns.slice();
  next[i] = t;
  return next;
}
