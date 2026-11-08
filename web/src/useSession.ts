import { useCallback, useEffect, useRef, useState } from "react";
import { api, events, type Project, type RunState, type Session, type Turn } from "./api";

type Loaded = { session: Session; running: boolean; delta: string; run: RunState; project: Project | null };

// One session, kept live: the saved record, the streaming text of the running turn, and the app's output.
export function useSession(id: string | null) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const deltaTurn = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api<Loaded>(`/api/sessions/${id}`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    setData(null);
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
  }, [id, reload]);

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
