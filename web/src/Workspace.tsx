import { ArrowUp, GitBranch, LoaderCircle, Menu, PanelRight, Plus, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_NAME, api, type AgentId, type AppState, type FileChange, type Mode } from "./api";
import { Monitor, type Tab } from "./Monitor";
import { Take } from "./Take";
import { ago, Button, CAP, cx, Kbd, Led, ModeSwitch, shortPath } from "./ui";
import { useSession } from "./useSession";

const QUICK = [
  { label: "Explain what you changed", prompt: "Explain what you just changed in plain words, as if I'm new to coding. Which files, what each change does, and how I can check it works." },
  { label: "Find bugs in it", prompt: "Look over what you changed in this session for bugs and edge cases. Fix what's real, and tell me what you fixed." },
  { label: "Add tests", prompt: "Add tests for what you changed in this session, using the testing setup this project already has (or the simplest standard one if it has none). Run them." },
  { label: "Make it work on phones", prompt: "Check the screens you changed at phone width and fix anything that overflows, is too small to tap, or breaks the layout." },
];

function Rack({ state, current, currentRunning, onOpen, onNew, onClose }: { state: AppState | null; current: string; currentRunning: boolean; onOpen: (id: string) => void; onNew: () => void; onClose?: () => void }) {
  return (
    <nav aria-label="Sessions" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="silk">Sessions</h2>
        <div className="flex gap-1">
          <Button size="sm" tone="quiet" onClick={onNew} icon={<Plus className="h-3.5 w-3.5" />}>
            New
          </Button>
          {onClose && (
            <Button size="sm" tone="quiet" onClick={onClose} aria-label="Close sessions" icon={<X className="h-4 w-4" />} />
          )}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {(state?.sessions ?? []).map((s) => {
          const on = s.id === current;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                aria-current={on ? "page" : undefined}
                className={cx("flex w-full items-start gap-2.5 rounded-[5px] px-2 py-2 text-left transition-colors", on ? "bg-panel-3" : "hover:bg-panel-2")}
              >
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-[1px]" style={{ background: CAP[s.agent] }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-[14px]", on ? "text-silk" : "text-silk-2")}>{s.title}</span>
                  <span className="block truncate text-[12px] text-silk-3">
                    {shortPath(s.project).split(/[\\/]/).pop()} · {ago(s.updatedAt)}
                  </span>
                </span>
                {(s.id === current ? currentRunning : s.running) && <Led color="var(--color-clip)" blink label="Working" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Workspace({ id, state, onOpen, onHome, refreshState }: { id: string; state: AppState | null; onOpen: (id: string) => void; onHome: () => void; refreshState: () => void }) {
  const { data, error, reload } = useSession(id);
  const [text, setText] = useState("");
  const [agent, setAgent] = useState<AgentId>("claude");
  const [mode, setMode] = useState<Mode>("edit");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [tab, setTab] = useState<Tab>("changes");
  const [diff, setDiff] = useState<{ file: FileChange; from: string; to: string } | null>(null);
  const [rackOpen, setRackOpen] = useState(false);
  const [version, setVersion] = useState(0); // bumped after every action, so the monitor re-reads
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [models, setModels] = useState<Partial<Record<AgentId, string>>>({});
  const [suggest, setSuggest] = useState<Partial<Record<AgentId, string[]>>>({});
  const [councilUrl, setCouncilUrl] = useState<string | null>(null);
  const lane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ models: Partial<Record<AgentId, string>>; council?: string | null; suggestions?: Partial<Record<AgentId, string[]>> }>("/api/settings")
      .then((s) => {
        setModels(s.models ?? {});
        setCouncilUrl(s.council ?? null);
        setSuggest(s.suggestions ?? {});
      })
      .catch(() => {});
  }, []);
  const saveModel = (a: AgentId, value: string) =>
    void api<{ models: Partial<Record<AgentId, string>> }>("/api/settings", { body: { models: { [a]: value.trim() } } })
      .then((s) => setModels(s.models ?? {}))
      .catch((e) => setActionError(e instanceof Error ? e.message : String(e)));
  const box = useRef<HTMLTextAreaElement>(null);

  const session = data?.session;
  const running = !!data?.running;
  const turns = session?.turns ?? [];

  useEffect(() => {
    if (session) {
      setAgent(session.agent);
      setMode(session.mode);
    }
    // Only when a different session loads: later turns must not reset what the user just picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Follow the tape while it records, unless the user scrolled up to read.
  const last = turns.at(-1);
  const follow = `${turns.length}:${last?.items.length}:${data?.delta.length}`;
  useEffect(() => {
    const el = lane.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [follow]);

  // When a take finishes, the rack's titles and recording lights catch up.
  useEffect(() => {
    if (!running) {
      refreshState();
      setVersion((v) => v + 1);
    }
  }, [running, refreshState]);

  const installed = useMemo(() => (["claude", "codex"] as AgentId[]).filter((a) => state?.agents[a]?.installed), [state]);
  const canReview = installed.length === 2;

  async function act(tag: string, fn: () => Promise<unknown>) {
    setBusy(tag);
    setActionError("");
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
    setVersion((v) => v + 1);
    refreshState();
  }

  const send = (prompt: string, allow?: string[]) =>
    act("send", async () => {
      await api(`/api/sessions/${id}/send`, { body: { prompt, agent, mode, allow } });
      setText("");
    });

  if (error && !data)
    return (
      <div className="mx-auto flex max-w-md flex-col items-start gap-3 p-10">
        <p className="text-[15px]">{error}</p>
        <Button onClick={onHome}>Back to projects</Button>
      </div>
    );
  if (!data || !session) return <LoaderCircle className="m-10 h-5 w-5 animate-spin text-silk-3" aria-label="Loading" />;

  const projectName = shortPath(session.project).split(/[\\/]/).pop();

  return (
    <div className="grid h-dvh min-h-0 grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)_minmax(340px,30vw)]">
      {/* The rack: every session, newest first. A drawer on small screens. */}
      <aside className={cx("min-h-0 border-r border-rule bg-panel max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 max-lg:w-[86vw] max-lg:max-w-[320px] max-lg:shadow-[0_0_60px_rgb(0_0_0/0.6)] max-lg:transition-transform max-lg:duration-200", !rackOpen && "max-lg:-translate-x-full")}>
        <Rack state={state} current={id} currentRunning={running} onOpen={(s) => (setRackOpen(false), onOpen(s))} onNew={onHome} onClose={rackOpen ? () => setRackOpen(false) : undefined} />
      </aside>
      {rackOpen && <button type="button" aria-label="Close sessions" className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setRackOpen(false)} />}

      {/* The tape lane and the talkback composer. */}
      <main className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-[49px] shrink-0 items-center gap-2 border-b border-rule px-3 sm:px-5">
          <Button size="sm" tone="quiet" className="lg:hidden" aria-label="Sessions" onClick={() => setRackOpen(true)} icon={<Menu className="h-4 w-4" />} />
          <button type="button" onClick={onHome} aria-label="Kuvend, back to projects" className="flex h-5 shrink-0 items-end gap-[2px] pr-1">
            <span className="h-2 w-[4px] rounded-[1px] bg-go" />
            <span className="h-3.5 w-[4px] rounded-[1px] bg-warn" />
            <span className="h-5 w-[4px] rounded-[1px] bg-clip" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium">{session.title}</h1>
          <span className="hidden items-center gap-1.5 font-mono text-[12px] text-silk-3 sm:flex">
            {projectName}
            {session.branch && (
              <>
                <GitBranch className="h-3.5 w-3.5" aria-hidden /> {session.branch}
              </>
            )}
          </span>
          <Button size="sm" tone="quiet" className="lg:hidden" aria-label="Changes and run" onClick={() => setMonitorOpen(true)} icon={<PanelRight className="h-4 w-4" />} />
          {/* The mixdown: save, with its clip light. Opens the save check. */}
          <Button
            size="sm"
            onClick={() => {
              setTab("save");
              setDiff(null);
              setMonitorOpen(true);
            }}
            icon={<Led color={turns.some((t) => t.files?.length && !t.undone) ? "var(--color-warn)" : "var(--color-go)"} />}
          >
            Save
          </Button>
          <Button
            size="sm"
            tone="quiet"
            aria-label="Delete session"
            title="Delete this session (your files stay as they are)"
            onClick={() => void act("delete", async () => (await api(`/api/sessions/${id}`, { method: "DELETE" }), onHome()))}
            icon={<Trash2 className="h-3.5 w-3.5" />}
          />
        </div>

        <div ref={lane} className="min-h-0 flex-1 overflow-auto px-3 pt-6 sm:px-6">
          <div className="mx-auto max-w-[820px]">
            {turns.length === 0 ? (
              <div className="flex flex-col gap-2 py-16">
                <p className="text-[22px] font-semibold tracking-[-0.01em]">The tape is empty.</p>
                <p className="max-w-[52ch] text-[15px] text-silk-2">Ask for something below. Each message becomes a take: you'll see what the agent did, which files it touched, and you can drop the take if you don't like it.</p>
              </div>
            ) : (
              turns.map((t, i) => (
                <Take
                  key={t.id}
                  turn={t}
                  cwd={session.cwd}
                  index={i + 1}
                  last={i === turns.length - 1}
                  delta={i === turns.length - 1 ? data.delta : ""}
                  actions={{
                    busy,
                    canReview,
                    councilLinked: !!councilUrl,
                    onCouncil: () => void act(`council:${t.id}`, async () => {
                      await api(`/api/sessions/${id}/turns/${t.id}/council`, { body: {} });
                      await reload();
                    }),
                    onCouncilRefresh: () => void api(`/api/sessions/${id}/turns/${t.id}/council`).then(() => reload()),
                    onCouncilApply: () => void act("send", () => api(`/api/sessions/${id}/turns/${t.id}/council/apply`, { body: {} })),
                    onUndo: () => void act(`undo:${t.id}`, () => api(`/api/sessions/${id}/turns/${t.id}/undo`, { body: {} })),
                    onRedo: () => void act(`redo:${t.id}`, () => api(`/api/sessions/${id}/turns/${t.id}/redo`, { body: {} })),
                    onReview: () => void act(`review:${t.id}`, () => api(`/api/sessions/${id}/turns/${t.id}/review`, { body: {} })),
                    onAllow: (allow) => void send("You're allowed to do that now. Go ahead and continue.", allow),
                    onOpenFile: (file) => {
                      if (!t.before || !t.after) return;
                      setDiff({ file, from: t.before, to: t.after });
                      setMonitorOpen(true);
                    },
                  }}
                />
              ))
            )}
          </div>
        </div>

        <form
          className="border-t border-rule bg-panel px-3 pt-3 pb-3 sm:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !running) void send(text);
          }}
        >
          <div className="mx-auto flex max-w-[820px] flex-col gap-2.5">
            {!running && turns.length > 0 && (
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                {QUICK.map((q) => (
                  <button key={q.label} type="button" disabled={!!busy} onClick={() => void send(q.prompt)} className="shrink-0 rounded-[4px] border border-rule px-2.5 py-1 text-[13px] text-silk-2 transition-colors hover:border-rule-hi hover:text-silk disabled:opacity-40">
                    {q.label}
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-[6px] border border-rule-hi bg-desk focus-within:border-silk-3">
              <label htmlFor="talkback" className="sr-only">
                Message to {AGENT_NAME[agent]}
              </label>
              <textarea
                id="talkback"
                ref={box}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (text.trim() && !running) void send(text);
                  }
                }}
                rows={Math.min(8, Math.max(2, text.split("\n").length))}
                placeholder={running ? `${AGENT_NAME[session.agent]} is working. You can type your next message.` : `Tell ${AGENT_NAME[agent]} what to do`}
                className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-silk-3"
              />
              <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
                <div role="radiogroup" aria-label="Agent" className="inline-flex rounded-[5px] border border-rule p-[2px]">
                  {(["claude", "codex"] as AgentId[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={agent === a}
                      disabled={!!state && !installed.includes(a)}
                      onClick={() => setAgent(a)}
                      className={cx("font-label flex min-h-8 items-center gap-1.5 rounded-[3px] px-2.5 text-[13px] font-semibold transition-colors disabled:opacity-35", agent === a ? "bg-panel-3 text-silk" : "text-silk-3 hover:text-silk")}
                    >
                      <span className="h-2 w-2 rounded-[1px]" style={{ background: CAP[a] }} aria-hidden />
                      {a === "claude" ? "Claude" : "Codex"}
                    </button>
                  ))}
                </div>
                <ModeSwitch value={mode} onChange={setMode} />
                <input
                  key={`${agent}:${models[agent] ?? ""}`}
                  defaultValue={models[agent] ?? ""}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== (models[agent] ?? "")) saveModel(agent, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  list={`models-${agent}`}
                  aria-label={`Model for ${AGENT_NAME[agent]}`}
                  title={`Which model ${AGENT_NAME[agent]} uses. Leave empty for its own default. Saved for every session.`}
                  placeholder="default model"
                  className="min-h-8 w-[132px] rounded-[4px] border border-rule bg-transparent px-2 font-mono text-[12px] text-silk-2 outline-none placeholder:font-sans placeholder:text-silk-3 focus:border-silk-3"
                />
                <datalist id={`models-${agent}`}>
                  {(suggest[agent] ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <span className="ml-auto hidden items-center gap-1 text-[12px] text-silk-3 2xl:flex">
                  <Kbd>Enter</Kbd> to send, <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
                </span>
                {running ? (
                  <Button size="sm" tone="danger" className="max-2xl:ml-auto" onClick={() => void act("stop", () => api(`/api/sessions/${id}/stop`, { body: {} }))} icon={<Square className="h-3 w-3 fill-current" />}>
                    Stop
                  </Button>
                ) : (
                  <Button type="submit" size="sm" tone="primary" className="max-2xl:ml-auto" disabled={!text.trim() || busy === "send"} aria-label="Send" icon={busy === "send" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}>
                    Send
                  </Button>
                )}
              </div>
            </div>
            {actionError && <p className="text-[13.5px] text-clip">{actionError}</p>}
          </div>
        </form>
      </main>

      {/* The monitor: what changed, the running app, saving, notes. A sheet on small screens. */}
      <aside className={cx("flex min-h-0 flex-col border-l border-rule bg-panel max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:h-[82dvh] max-lg:rounded-t-[10px] max-lg:border-t max-lg:shadow-[0_-20px_60px_rgb(0_0_0/0.6)] max-lg:transition-transform max-lg:duration-200", !monitorOpen && "max-lg:translate-y-full")}>
        <div className="flex justify-end px-2 pt-2 lg:hidden">
          <Button size="sm" tone="quiet" onClick={() => setMonitorOpen(false)} aria-label="Close" icon={<X className="h-4 w-4" />} />
        </div>
        <Monitor version={version} session={session} run={data.run} tab={tab} setTab={setTab} busy={busy} diff={diff} setDiff={setDiff} onFix={() => void act("fix", () => api(`/api/sessions/${id}/run/fix`, { body: {} }))} />
      </aside>
      {monitorOpen && <button type="button" aria-label="Close" className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setMonitorOpen(false)} />}
    </div>
  );
}
