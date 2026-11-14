import { useEffect, useState } from "react";
import type { AgentId, Turn, Usage } from "./api";
import { AGENT_NAME } from "./api";
import { Led, Meter, cx } from "./ui";

// How full the agent's context is, and whether its prompt cache is still warm. The numbers are the CLI's
// own (Claude's result, Codex's session file, OpenCode's step usage); unknown stays unknown.

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const clock = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

// Seconds of warm cache left after a turn, or null when the CLI didn't say how long it keeps it.
export function cacheLeft(u: Usage, endedAt: string | undefined, now: number): number | null {
  if (!u.ttlSec || !endedAt) return null;
  return Math.max(0, u.ttlSec - (now - new Date(endedAt).getTime()) / 1000);
}

export function hitRate(u: Usage): number | null {
  const all = u.cacheRead + u.cacheWrite + u.fresh;
  return all > 0 ? u.cacheRead / all : null;
}

export function ContextWatch({ turns, agent, running, onCompact }: { turns: Turn[]; agent: AgentId; running: boolean; onCompact?: () => void }) {
  const own = [...turns].reverse().filter((t) => t.usage && t.agent === agent && t.kind === "chat");
  const turn = own[0];
  // A turn that didn't report the window (a /compact) keeps the one the agent reported before.
  const u = turn?.usage ? { ...turn.usage, window: turn.usage.window ?? own.find((t) => t.usage?.window)?.usage?.window ?? null } : undefined;
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const left = u ? cacheLeft(u, turn?.endedAt, now) : null;
  useEffect(() => {
    if (left === null || left <= 0 || running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left === null || left <= 0, running]);
  if (!u) return null;

  const pct = u.context !== null && u.window ? Math.min(1, u.context / u.window) : null;
  const hit = hitRate(u);
  const warm = left !== null && left > 0;
  const tone = pct === null ? "text-silk-3" : pct >= 0.9 ? "text-clip" : pct >= 0.7 ? "text-warn" : "text-silk-2";
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Context ${pct === null ? "size unknown" : `${Math.round(pct * 100)}% full`}, prompt cache ${running ? "in use" : warm ? `warm for ${clock(left!)}` : left === null ? "status unknown" : "cold"}`}
        className="flex min-h-8 items-center gap-2 rounded-full bg-black/25 px-2.5 text-[12px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] hover:bg-black/35"
      >
        {pct !== null ? <Meter value={u.context!} max={u.window!} segments={8} label="Context used" /> : <span className="font-mono text-silk-3">{u.context !== null ? k(u.context) : "–"}</span>}
        {pct !== null && <span className={cx("tnum font-mono", tone)}>{Math.round(pct * 100)}%</span>}
        <span className="flex items-center gap-1 text-silk-3">
          <Led color={running || warm ? "var(--color-go)" : "var(--color-silk-3)"} on={running || warm || left === null} blink={running} />
          {!running && left !== null && <span className="tnum font-mono">{warm ? clock(left) : "cold"}</span>}
        </span>
      </button>
      {open && (
        <div role="dialog" aria-label="Context and cache" className="absolute right-0 z-30 mt-2 w-[min(19rem,calc(100vw-2rem))] rounded-[14px] bg-panel-2 p-4 text-[13px] shadow-[0_18px_50px_rgb(0_0_0/0.5),inset_0_0_0_1px_rgb(255_255_255/0.08)]">
          <p className="mb-2 font-medium">{AGENT_NAME[agent]}, after the last turn</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-silk-2">
            <dt>Context</dt>
            <dd className="tnum text-right font-mono text-silk">{u.context !== null ? `${k(u.context)}${u.window ? ` / ${k(u.window)}` : ""}` : "not reported"}</dd>
            <dt>Read from cache</dt>
            <dd className="tnum text-right font-mono text-silk">{k(u.cacheRead)}{hit !== null ? ` · ${Math.round(hit * 100)}%` : ""}</dd>
            <dt>Written to cache</dt>
            <dd className="tnum text-right font-mono text-silk">{k(u.cacheWrite)}</dd>
            <dt>New input</dt>
            <dd className="tnum text-right font-mono text-silk">{k(u.fresh)}</dd>
            <dt>Output</dt>
            <dd className="tnum text-right font-mono text-silk">{k(u.output)}</dd>
            <dt>Cache</dt>
            <dd className="text-right text-silk">{running ? "in use now" : left === null ? `${AGENT_NAME[agent]} doesn't say how long` : warm ? `warm, ${clock(left)} left` : `cold: the next turn re-reads ${k(u.context ?? u.cacheRead + u.cacheWrite + u.fresh)}`}</dd>
          </dl>
          {onCompact && pct !== null && pct >= 0.7 && (
            <button type="button" onClick={() => (setOpen(false), onCompact())} disabled={running} className="mt-3 min-h-9 w-full rounded-full bg-white/[0.1] text-[13px] font-medium hover:bg-white/[0.16] disabled:opacity-40">
              Compact the conversation
            </button>
          )}
        </div>
      )}
    </div>
  );
}
