import { AlertTriangle, ChevronRight, Ear, ExternalLink, Gavel, LoaderCircle, RotateCcw, RotateCw, ShieldAlert, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AGENT_NAME, MODE_INFO, type Council, type FileChange, type Item, type Turn } from "./api";
import { renderMarkdown } from "./md";
import { AgentDot, Button, cx, Led, Meter } from "./ui";

// Paths inside the project are shown relative to it.
const relative = (detail: string, cwd: string) => {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm(cwd);
  const d = norm(detail);
  return d.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? d.slice(base.length + 1) : detail;
};

function ToolRow({ item, cwd }: { item: Extract<Item, { kind: "tool" }>; cwd: string }) {
  const [open, setOpen] = useState(false);
  const state = item.ok === undefined ? "running" : item.ok ? "ok" : "failed";
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => item.output && setOpen((o) => !o)}
        aria-expanded={item.output ? open : undefined}
        className={cx("flex w-full min-w-0 items-center gap-2 rounded-[8px] px-2 py-1 text-left font-mono text-[12.5px]", item.output ? "hover:bg-white/[0.04]" : "cursor-default")}
      >
        <Led on color={state === "failed" ? "var(--color-clip)" : state === "running" ? "var(--color-warn)" : "var(--color-go)"} blink={state === "running"} label={state} />
        <span className="shrink-0 text-silk-2">{item.name}</span>
        <span className="min-w-0 truncate text-silk-3">{relative(item.detail, cwd)}</span>
        {item.output && <ChevronRight className={cx("ml-auto h-3.5 w-3.5 shrink-0 text-silk-3 transition-transform duration-150", open && "rotate-90")} aria-hidden />}
      </button>
      {open && item.output && <pre className="mt-1 mb-2 max-h-72 overflow-auto rounded-[12px] bg-black/35 px-3.5 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-silk-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">{item.output}</pre>}
    </li>
  );
}

// The tool calls between two pieces of text, folded into one line until opened.
function ToolGroup({ items, cwd }: { items: Extract<Item, { kind: "tool" }>[]; cwd: string }) {
  const [open, setOpen] = useState(false);
  const failed = items.filter((i) => i.ok === false).length;
  const running = items.some((i) => i.ok === undefined);
  if (items.length <= 2 || open)
    return (
      <ul className="flex flex-col gap-0.5 border-l border-rule pl-2">
        {items.map((i, n) => (
          <ToolRow key={`${i.id}-${n}`} item={i} cwd={cwd} />
        ))}
      </ul>
    );
  return (
    <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 self-start rounded-full bg-white/[0.04] px-3 py-1 font-mono text-[12px] text-silk-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] hover:text-silk">
      <Terminal className="h-3.5 w-3.5" aria-hidden />
      {items.length} steps{failed ? `, ${failed} failed` : ""}
      {running && <Led color="var(--color-warn)" blink label="running" />}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

export function FileMeters({ files, onOpen }: { files: FileChange[]; onOpen?: (f: FileChange) => void }) {
  const max = Math.max(20, ...files.map((f) => f.added + f.removed));
  return (
    <ul className="flex flex-col">
      {files.map((f) => (
        <li key={f.path}>
          <button type="button" onClick={() => onOpen?.(f)} disabled={!onOpen} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[9px] px-2 py-1.5 text-left hover:bg-white/[0.05] disabled:hover:bg-transparent">
            <span className="min-w-0 truncate font-mono text-[12.5px]">
              <span className={cx("mr-1.5", f.status === "added" ? "text-go" : f.status === "deleted" ? "text-clip" : "text-silk-3")}>{f.status === "added" ? "new" : f.status === "deleted" ? "gone" : f.status === "renamed" ? "moved" : "edit"}</span>
              {f.path}
            </span>
            <Meter value={f.added + f.removed} max={max} segments={8} label={`${f.added} lines added, ${f.removed} removed`} />
            <span className="w-[84px] text-right font-mono text-[12px]">
              <span className="text-go">+{f.added}</span> <span className="text-clip">−{f.removed}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function elapsed(t: Turn) {
  const s = Math.round(((t.endedAt ? Date.parse(t.endedAt) : Date.now()) - Date.parse(t.startedAt)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

// The council's debate on this take: where it stands, then the judge's decision and one tap to act on it.
function CouncilCard({ council, agent, busy, onRefresh, onApply }: { council: Council; agent: Turn["agent"]; busy: string; onRefresh: () => void; onApply: () => void }) {
  const done = council.status === "done";
  const stopped = ["cancelled", "refused", "failed"].includes(council.status);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    if (done || stopped) return;
    const t = setInterval(() => refresh.current(), 8000);
    return () => clearInterval(t);
  }, [done, stopped]);
  const v = council.verdict;
  const stage = council.status === "queued" ? "Waiting for a seat at the table" : council.status === "evidence" ? "Reading the change" : council.status === "judging" ? `The judge is scoring round ${council.rounds}` : `Debating, round ${Math.max(1, council.rounds)} of up to 3`;
  return (
    <div className="plate flex flex-col gap-3 rounded-[18px] p-4 shadow-[inset_0_0_0_1px_rgb(241_180_90/0.3)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Gavel className="h-4 w-4 text-warn" aria-hidden />
        <span className="font-medium">The council</span>
        {!done && !stopped && (
          <span className="flex items-center gap-1.5 text-[13px] text-silk-2">
            <Led color="var(--color-warn)" blink /> {stage}
            {council.agreement !== null && <span className="font-mono text-[12px]"> · {council.agreement}% agree</span>}
          </span>
        )}
        <a href={council.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[13px] text-codex hover:underline">
          Watch the debate <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
      {stopped && <p className="text-[14px] text-clip">The room {council.status === "refused" ? "was refused" : "stopped"}{council.error ? `: ${council.error}` : "."}</p>}
      {!done && !stopped && council.error && <p className="text-[13px] text-clip">{council.error}</p>}
      {done && v && (
        <>
          <p className="text-[17px] leading-snug font-semibold">{v.decision ?? v.recommendation}</p>
          {v.next_step && <p className="text-[14px] text-silk-2">Next: {v.next_step}</p>}
          {v.dissent.length > 0 && (
            <ul className="list-[square] pl-5 text-[13.5px] text-silk-2">
              {v.dissent.slice(0, 3).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          <p className="text-[12.5px] text-silk-3">
            {v.outcome}
            {v.confidence !== null ? `, ${v.confidence}% confident` : ""}, judged by {v.judge}
          </p>
          <Button size="sm" tone="primary" className="self-start" disabled={!!busy} onClick={onApply}>
            Send the verdict to {AGENT_NAME[agent]}
          </Button>
        </>
      )}
    </div>
  );
}

type Actions = {
  busy: string;
  councilLinked: boolean;
  onCouncil: () => void;
  onCouncilRefresh: () => void;
  onCouncilApply: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onReview: () => void;
  onAllow: (allow: string[]) => void;
  onOpenFile: (f: FileChange) => void;
  canReview: boolean;
};

export function Take({ turn, cwd, delta, index, last, actions }: { turn: Turn; cwd: string; delta: string; index: number; last: boolean; actions: Actions }) {
  // Group consecutive tool calls so a long run of reads doesn't bury the answer.
  const blocks: ({ kind: "tools"; items: Extract<Item, { kind: "tool" }>[] } | Exclude<Item, { kind: "tool" }>)[] = [];
  for (const it of turn.items) {
    if (it.kind === "tool") {
      const prev = blocks.at(-1);
      if (prev && prev.kind === "tools") prev.items.push(it);
      else blocks.push({ kind: "tools", items: [it] });
    } else blocks.push(it);
  }
  const running = turn.status === "running";
  const undone = !!turn.undone;
  const files = turn.files ?? [];
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const review = turn.kind === "review";

  return (
    <article aria-label={`Turn ${index}`} className={cx("take-in flex min-w-0 flex-col gap-4 pb-12", undone && "opacity-55")}>
      {/* What you asked: your side of the conversation. */}
      {!review && (
        <p className={cx("max-w-[86%] self-end rounded-[22px] rounded-br-[8px] bg-white/[0.075] px-4 py-3 text-[15.5px] leading-relaxed whitespace-pre-wrap shadow-[inset_0_1px_0_rgb(255_255_255/0.06),inset_0_0_0_1px_rgb(255_255_255/0.05)]", undone && "line-through decoration-silk-3")} style={{ overflowWrap: "anywhere" }}>
          {turn.prompt.length > 900 ? `${turn.prompt.slice(0, 900)}…` : turn.prompt}
        </p>
      )}

      <div className="flex min-w-0 flex-col gap-3">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-silk-3">
          <AgentDot agent={turn.agent} />
          <span className="font-medium text-silk-2">{AGENT_NAME[turn.agent]}</span>
          <span>{review ? "Second opinion" : MODE_INFO[turn.mode].label}</span>
          {running ? (
            <span className="text-dawn">Working {elapsed(turn)}</span>
          ) : (
            <span>
              {turn.status === "stopped" ? "Stopped" : turn.status === "failed" ? "Failed" : ""} {turn.status !== "done" ? "after " : ""}
              {elapsed(turn)}
              {typeof turn.costUsd === "number" && turn.costUsd > 0 && (
                <span className="font-mono" title="What this turn would cost at API prices. On a Claude plan it counts against your plan's limits instead.">
                  {" "}
                  ~${turn.costUsd.toFixed(2)}
                </span>
              )}
            </span>
          )}
        </header>
        {review && <p className="text-[14px] text-silk-2">{turn.prompt}</p>}

        {blocks.length === 0 && running && !delta && <p className="shimmer text-[15px]">{AGENT_NAME[turn.agent]} is reading your project…</p>}
        {blocks.map((b, i) => {
          if (b.kind === "tools") return <ToolGroup key={i} items={b.items} cwd={cwd} />;
          if (b.kind === "text") return <div key={i} className="prose-take" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />;
          if (b.kind === "error")
            return (
              <p key={i} className="flex items-start gap-2 rounded-[14px] bg-clip/[0.08] px-3.5 py-2.5 text-[14px] text-clip shadow-[inset_0_0_0_1px_rgb(240_106_85/0.3)]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {b.text}
              </p>
            );
          return (
            <div key={i} className="flex flex-col gap-2.5 rounded-[16px] bg-warn/[0.06] p-4 shadow-[inset_0_0_0_1px_rgb(241_180_90/0.3)]">
              <p className="flex items-center gap-2 text-[14px] font-medium">
                <ShieldAlert className="h-4 w-4 text-warn" aria-hidden /> It wanted to do {b.tools.length === 1 ? "this" : "these"}, and {MODE_INFO[turn.mode].label} mode stopped it:
              </p>
              <ul className="flex flex-col gap-1 font-mono text-[12.5px] text-silk-2">
                {b.tools.map((t, n) => (
                  <li key={n} className="truncate">
                    {t.name} {t.detail}
                  </li>
                ))}
              </ul>
              {last && !running && (
                <Button size="sm" tone="primary" className="self-start" disabled={!!actions.busy} onClick={() => actions.onAllow(b.tools.map((t) => t.allow))}>
                  Allow and continue
                </Button>
              )}
            </div>
          );
        })}
        {running && delta && <div className="prose-take" dangerouslySetInnerHTML={{ __html: renderMarkdown(delta) }} />}
        {running && (blocks.length > 0 || delta) && <Led color="var(--color-dawn)" blink label="Working" />}

        {/* What actually changed on disk, measured from the checkpoints, not from what the agent said. */}
        {files.length > 0 && (
          <div className="plate flex flex-col gap-2 rounded-[16px] p-3">
            <p className="silk flex items-center gap-2 px-2">
              {files.length} {files.length === 1 ? "file" : "files"} changed
              <span className="font-mono text-[12px]">
                <span className="text-go">+{added}</span> <span className="text-clip">−{removed}</span>
              </span>
            </p>
            <FileMeters files={files} onOpen={undone ? undefined : actions.onOpenFile} />
          </div>
        )}
        {!running && turn.before && turn.after && files.length === 0 && !review && <p className="silk">No files changed.</p>}

        {!running && turn.before && (files.length > 0 || undone) && (
          <div className="flex flex-wrap items-center gap-2">
            {undone ? (
              <>
                <span className="text-[13.5px] text-silk-2">Undone. Your files are back to how they were before this turn.</span>
                <Button size="sm" tone="quiet" disabled={!!actions.busy} onClick={actions.onRedo} icon={actions.busy === `redo:${turn.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}>
                  Redo
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" disabled={!!actions.busy} onClick={actions.onUndo} icon={actions.busy === `undo:${turn.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}>
                  Undo
                </Button>
                {!review && actions.councilLinked && !turn.council && (
                  <Button size="sm" tone="quiet" disabled={!!actions.busy} onClick={actions.onCouncil} icon={actions.busy === `council:${turn.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Gavel className="h-3.5 w-3.5" />}>
                    Ask the council
                  </Button>
                )}
                {!review && actions.canReview && (
                  <Button size="sm" tone="quiet" disabled={!!actions.busy} onClick={actions.onReview} icon={actions.busy === `review:${turn.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Ear className="h-3.5 w-3.5" />}>
                    Second opinion from {AGENT_NAME[turn.agent === "claude" ? "codex" : "claude"]}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
        {turn.council && <CouncilCard council={turn.council} agent={turn.agent} busy={actions.busy} onRefresh={actions.onCouncilRefresh} onApply={actions.onCouncilApply} />}
      </div>
    </article>
  );
}
