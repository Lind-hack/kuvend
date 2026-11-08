import { AlertTriangle, ChevronRight, Ear, LoaderCircle, RotateCcw, RotateCw, ShieldAlert, Terminal } from "lucide-react";
import { useState } from "react";
import { AGENT_NAME, MODE_INFO, type FileChange, type Item, type Turn } from "./api";
import { renderMarkdown } from "./md";
import { Button, CAP, cx, Led, Meter, Scribble } from "./ui";

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
        className={cx("flex w-full min-w-0 items-center gap-2 rounded-[3px] px-1.5 py-1 text-left font-mono text-[12.5px]", item.output ? "hover:bg-panel-2" : "cursor-default")}
      >
        <Led on color={state === "failed" ? "var(--color-clip)" : state === "running" ? "var(--color-warn)" : "var(--color-go)"} blink={state === "running"} label={state} />
        <span className="shrink-0 text-silk-2">{item.name}</span>
        <span className="min-w-0 truncate text-silk-3">{relative(item.detail, cwd)}</span>
        {item.output && <ChevronRight className={cx("ml-auto h-3.5 w-3.5 shrink-0 text-silk-3 transition-transform duration-150", open && "rotate-90")} aria-hidden />}
      </button>
      {open && item.output && <pre className="mt-1 mb-2 max-h-72 overflow-auto rounded-[4px] border border-rule bg-desk px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-silk-2">{item.output}</pre>}
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
    <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 self-start rounded-[3px] border-l border-rule py-1 pr-2 pl-3.5 font-mono text-[12.5px] text-silk-3 hover:text-silk">
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
          <button type="button" onClick={() => onOpen?.(f)} disabled={!onOpen} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[3px] px-1.5 py-1 text-left hover:bg-panel-2 disabled:hover:bg-transparent">
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

type Actions = {
  busy: string;
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
    <article aria-label={`Take ${index}`} className={cx("take-in relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 sm:grid-cols-[44px_minmax(0,1fr)]", undone && "opacity-60")}>
      {/* The take number on the tape counter, and the lane line down to the next take. */}
      <div className="flex flex-col items-center">
        <span className="font-mono text-[12px] text-silk-3 tabular-nums">{String(index).padStart(2, "0")}</span>
        {!last && <span className="mt-2 w-px flex-1 bg-rule" aria-hidden />}
      </div>

      <div className="flex min-w-0 flex-col gap-3 pb-9">
        {/* What was asked, written on the tape. */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Scribble agent={turn.agent} small />
          <span className="silk">{review ? "Second listen" : MODE_INFO[turn.mode].label}</span>
          {running ? (
            <span className="flex items-center gap-1.5 text-[12.5px] text-clip">
              <Led color="var(--color-clip)" blink /> Working · {elapsed(turn)}
            </span>
          ) : (
            <span className="text-[12.5px] text-silk-3">
              {turn.status === "stopped" ? "Stopped" : turn.status === "failed" ? "Failed" : "Done"} in {elapsed(turn)}
              {typeof turn.costUsd === "number" && turn.costUsd > 0 && (
                <span className="font-mono" title="What this take would cost at API prices. On a Claude plan it counts against your plan's limits instead.">
                  {" "}
                  · ~${turn.costUsd.toFixed(2)}
                </span>
              )}
            </span>
          )}
        </header>

        <p className={cx("max-w-[72ch] text-[16px] leading-relaxed font-medium whitespace-pre-wrap", undone && "line-through decoration-silk-3")} style={{ overflowWrap: "anywhere" }}>
          {review ? turn.prompt : turn.prompt.length > 600 ? `${turn.prompt.slice(0, 600)}…` : turn.prompt}
        </p>

        <div className="flex min-w-0 flex-col gap-3 rounded-[6px] border border-rule bg-panel p-4" style={{ boxShadow: `inset 0 2px 0 ${CAP[turn.agent]}` }}>
          {blocks.length === 0 && running && !delta && (
            <p className="flex items-center gap-2 text-[14px] text-silk-3">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {AGENT_NAME[turn.agent]} is reading your project…
            </p>
          )}
          {blocks.map((b, i) => {
            if (b.kind === "tools") return <ToolGroup key={i} items={b.items} cwd={cwd} />;
            if (b.kind === "text") return <div key={i} className="prose-take" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />;
            if (b.kind === "error")
              return (
                <p key={i} className="flex items-start gap-2 rounded-[4px] border border-clip/40 bg-clip/[0.07] px-3 py-2 text-[14px] text-clip">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {b.text}
                </p>
              );
            return (
              <div key={i} className="flex flex-col gap-2.5 rounded-[4px] border border-warn/40 bg-warn/[0.06] p-3">
                <p className="flex items-center gap-2 text-[14px] font-medium">
                  <ShieldAlert className="h-4 w-4 text-warn" aria-hidden /> It wanted to do {b.tools.length === 1 ? "this" : "these"}, and Edit mode stopped it:
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
        </div>

        {/* What actually changed on disk, measured from the checkpoints, not from what the agent said. */}
        {files.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="silk flex items-center gap-2">
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
                <span className="text-[13.5px] text-silk-2">Undone. Your files are back to how they were before this take.</span>
                <Button size="sm" tone="quiet" disabled={!!actions.busy} onClick={actions.onRedo} icon={actions.busy === `redo:${turn.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}>
                  Redo
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" disabled={!!actions.busy} onClick={actions.onUndo} icon={actions.busy === `undo:${turn.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}>
                  Undo this take
                </Button>
                {!review && actions.canReview && (
                  <Button size="sm" tone="quiet" disabled={!!actions.busy} onClick={actions.onReview} icon={actions.busy === `review:${turn.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Ear className="h-3.5 w-3.5" />}>
                    Second listen from {AGENT_NAME[turn.agent === "claude" ? "codex" : "claude"]}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
