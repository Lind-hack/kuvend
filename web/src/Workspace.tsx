import { ArrowUp, GitBranch, LoaderCircle, Menu, MoreHorizontal, Save, Server, Smartphone, Square, SquareTerminal, Trash2, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_NAME, api, onPhone, type AgentId, type AppState, type FileChange, type Mode, type Peer } from "./api";
import { Monitor, type Tab } from "./Monitor";
import { SendToServer } from "./Phone";
import type { Sheet as SheetName } from "./Sidebar";
import { Take } from "./Take";
import { AgentDot, Button, cx, ModeSwitch, shortPath } from "./ui";
import { useSession } from "./useSession";

const QUICK = [
  { label: "Explain what you changed", prompt: "Explain what you just changed in plain words, as if I'm new to coding. Which files, what each change does, and how I can check it works." },
  { label: "Find bugs in it", prompt: "Look over what you changed in this session for bugs and edge cases. Fix what's real, and tell me what you fixed." },
  { label: "Add tests", prompt: "Add tests for what you changed in this session, using the testing setup this project already has (or the simplest standard one if it has none). Run them." },
  { label: "Make it work on phones", prompt: "Check the screens you changed at phone width and fix anything that overflows, is too small to tap, or breaks the layout." },
];

// Long chats (a terminal chat brought in can have hundreds of turns) show their recent part; older
// turns load on request, so a phone stays fast.
const WINDOW = 30;
const MemoTake = memo(Take);

export function Workspace({ id, remote, state, onHome, refreshState, onNav, onRunning, onSheet }: { id: string; remote?: Peer; state: AppState | null; onOpen: (id: string) => void; onHome: () => void; refreshState: () => void; onNav: () => void; onRunning: (r: boolean) => void; onSheet: (s: SheetName) => void }) {
  const { data, error, reload } = useSession(id);
  const [text, setText] = useState("");
  const [agent, setAgent] = useState<AgentId>("claude");
  const [mode, setMode] = useState<Mode>("edit");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [tab, setTab] = useState<Tab>("changes");
  const [diff, setDiff] = useState<{ file: FileChange; from: string; to: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sending, setSending] = useState(false);
  const [shown, setShown] = useState(WINDOW);
  const [models, setModels] = useState<Partial<Record<AgentId, string>>>({});
  const [suggest, setSuggest] = useState<Partial<Record<AgentId, string[]>>>({});
  const [councilUrl, setCouncilUrl] = useState<string | null>(null);
  const [hint, setHint] = useState(() => {
    try {
      return localStorage.getItem(`kuvend.hint.${id}`) !== "seen";
    } catch {
      return true;
    }
  });
  const lane = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

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

  const session = data?.session;
  const running = !!data?.running;
  const turns = session?.turns ?? [];
  useEffect(() => onRunning(running), [running, onRunning]);

  useEffect(() => {
    if (session) {
      setAgent(session.agent);
      setMode(session.mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Open at the latest turn, then follow while it runs unless the user scrolled up to read.
  const last = turns.at(-1);
  const follow = `${turns.length}:${last?.items.length}:${data?.delta.length}`;
  const first = useRef(true);
  useEffect(() => {
    const el = lane.current;
    if (!el || !session) return;
    if (first.current) {
      el.scrollTop = el.scrollHeight;
      first.current = false;
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < 280) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [follow, session]);

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
      void reload();
    });

  if (error && !data)
    return (
      <div className="mx-auto flex max-w-md flex-col items-start gap-4 p-10">
        <h1 className="display text-[36px]">This chat isn't here.</h1>
        <p className="text-[15px] text-silk-2">{error}</p>
        <Button onClick={onHome}>Home</Button>
      </div>
    );
  if (!data || !session) return <LoaderCircle className="m-10 h-5 w-5 animate-spin text-silk-3" aria-label="Loading" />;

  const projectName = shortPath(session.project).split(/[\\/]/).pop();
  const pending = turns.filter((t) => t.files?.length && !t.undone).length;
  const away = session.sentTo;
  const copy = session.mirrorOf && !session.mirrorOf.takenAt ? session.mirrorOf : null; // the server's copy of a laptop chat
  const hidden = Math.max(0, turns.length - shown);
  const dismissHint = () => {
    setHint(false);
    try {
      localStorage.setItem(`kuvend.hint.${id}`, "seen");
    } catch {
      /* fine */
    }
  };

  return (
    <div className="relative flex h-dvh min-h-0 flex-col">
      {/* Header: the chat's name and where it works; everything else is one tap away. */}
      <header className="flex shrink-0 items-center gap-2 px-3 pt-[max(0.6rem,env(safe-area-inset-top))] pb-2 sm:px-5">
        <Button size="sm" tone="quiet" className="lg:hidden" aria-label="Chats" onClick={onNav} icon={<Menu className="h-4 w-4" />} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-medium">{session.title}</h1>
          <p className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-silk-3">
            <AgentDot agent={session.agent} />
            <span className="truncate">{projectName}</span>
            {session.branch && (
              <span className="hidden items-center gap-1 font-mono sm:inline-flex">
                <GitBranch className="h-3 w-3" aria-hidden /> {session.branch}
              </span>
            )}
            {session.origin && (
              <span className="inline-flex shrink-0 items-center gap-1">
                <SquareTerminal className="h-3 w-3" aria-hidden /> from terminal
              </span>
            )}
            {session.handoff && <span className="shrink-0">from {session.handoff.from}</span>}
            {remote && (
              <span className="inline-flex shrink-0 items-center gap-1 text-dawn">
                <Server className="h-3 w-3" aria-hidden /> live on {remote.name}
              </span>
            )}
            {session.mirrorOf?.takenAt && <span className="shrink-0">taken over from {session.mirrorOf.name}</span>}
          </p>
        </div>
        <Button
          size="sm"
          tone="plain"
          onClick={() => {
            setTab("changes");
            setDiff(null);
            setMonitorOpen(true);
          }}
        >
          Changes{pending > 0 && <span className="ml-0.5 rounded-full bg-dawn/90 px-1.5 text-[11px] leading-[18px] font-semibold text-desk">{pending}</span>}
        </Button>
        <Button
          size="sm"
          tone="plain"
          className="max-sm:hidden"
          onClick={() => {
            setTab("save");
            setDiff(null);
            setMonitorOpen(true);
          }}
        >
          Save
        </Button>
        <div className="relative">
          <Button size="sm" tone="quiet" aria-label="More" aria-expanded={menu} onClick={() => setMenu((m) => !m)} icon={<MoreHorizontal className="h-4 w-4" />} />
          {menu && (
            <>
              <button type="button" aria-label="Close menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setMenu(false)} />
              <div role="menu" className="glass take-in absolute top-[calc(100%+8px)] right-0 z-40 flex w-[248px] flex-col rounded-[16px] p-1.5">
                <MenuItem
                  icon={<Save className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setMenu(false);
                    setTab("save");
                    setMonitorOpen(true);
                  }}
                  className="sm:hidden"
                >
                  Save
                </MenuItem>
                {!onPhone && (
                  <MenuItem icon={<Smartphone className="h-3.5 w-3.5" />} onClick={() => (setMenu(false), onSheet("phone"))}>
                    Continue on phone
                  </MenuItem>
                )}
                {!away && !remote && !session.mirrorOf && (
                  <MenuItem icon={<Server className="h-3.5 w-3.5" />} disabled={running} onClick={() => (setMenu(false), setSending(true))}>
                    Continue on your server
                  </MenuItem>
                )}
                <MenuItem icon={<Trash2 className="h-3.5 w-3.5" />} danger onClick={() => (setMenu(false), void act("delete", async () => (await api(`/api/sessions/${id}`, { method: "DELETE" }), onHome())))}>
                  Remove from Kuvend
                </MenuItem>
              </div>
            </>
          )}
        </div>
      </header>

      {/* The conversation: one reading column. */}
      <div ref={lane} className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-8">
        <div className="mx-auto flex max-w-[780px] flex-col pt-6 pb-48">
          {away && (
            <div className="glass mb-8 flex flex-col gap-3 rounded-[18px] p-4 sm:flex-row sm:items-center">
              <Server className="h-5 w-5 shrink-0 text-dawn" aria-hidden />
              <p className="min-w-0 flex-1 text-[14px] text-silk-2">
                This chat continues on <span className="text-silk">{away.name}</span>
                {away.url ? ", with your laptop off too." : "."} This copy is paused so the two don't drift apart.
              </p>
              <div className="flex shrink-0 gap-2">
                {away.url && (
                  <a href={away.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center rounded-full bg-white/[0.08] px-3 text-[13px] hover:bg-white/[0.12]">
                    Open there
                  </a>
                )}
                {away.peer && (
                  <Button size="sm" tone="primary" disabled={!!busy} onClick={() => void act("back", async () => (await api(`/api/sessions/${id}/bring-back`, { body: {} }), await reload()))} icon={busy === "back" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : undefined}>
                    Bring it back
                  </Button>
                )}
              </div>
            </div>
          )}
          {copy && (
            <div className="glass mb-8 flex flex-col gap-3 rounded-[18px] p-4 sm:flex-row sm:items-center">
              <Server className="h-5 w-5 shrink-0 text-dawn" aria-hidden />
              <p className="min-w-0 flex-1 text-[14px] text-silk-2">
                The server's copy of a chat on <span className="text-silk">{copy.name}</span>, as of {new Date(copy.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. If {copy.name} is on, open the chat from its section in the sidebar. If it's off, continue here: the agent picks up with the whole conversation.
              </p>
              <Button size="sm" tone="primary" className="shrink-0" disabled={!!busy} onClick={() => void act("take", async () => (await api(`/api/sessions/${id}/take-over`, { body: {} }), await reload()))} icon={busy === "take" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : undefined}>
                Continue here
              </Button>
            </div>
          )}
          {session.origin && hint && !away && (
            <div className="plate mb-8 flex items-start gap-3 rounded-[16px] px-4 py-3 text-[13.5px] text-silk-2">
              <SquareTerminal className="mt-0.5 h-4 w-4 shrink-0 text-silk-3" aria-hidden />
              <p className="flex-1">Continued from your terminal with its whole history. The next message resumes that exact chat, with the same skills, MCP servers and hooks. Close the terminal chat so only one place writes to it.</p>
              <button type="button" aria-label="Dismiss" onClick={dismissHint} className="grid h-7 w-7 place-items-center rounded-full text-silk-3 hover:bg-white/[0.07] hover:text-silk">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {turns.length === 0 ? (
            <div className="flex flex-col gap-3 py-20">
              <h2 className="display text-[44px]">A fresh start.</h2>
              <p className="max-w-[52ch] text-[15px] text-silk-2">Ask for something below. You'll see what the agent did and which files it touched, and you can undo any turn.</p>
            </div>
          ) : (
            <>
              {hidden > 0 && (
                <button type="button" onClick={() => setShown((n) => n + WINDOW)} className="mb-8 self-center rounded-full bg-white/[0.05] px-4 py-1.5 text-[13px] text-silk-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] hover:text-silk">
                  Show {Math.min(WINDOW, hidden)} earlier {hidden === 1 ? "turn" : "turns"}{hidden > WINDOW ? ` (${hidden} in all)` : ""}
                </button>
              )}
              {turns.slice(-shown).map((t, i, arr) => (
                <MemoTake
                  key={t.id}
                  turn={t}
                  cwd={session.cwd}
                  index={turns.length - arr.length + i + 1}
                  last={i === arr.length - 1}
                  delta={i === arr.length - 1 ? data.delta : ""}
                  actions={{
                    busy,
                    canReview,
                    councilLinked: !!councilUrl,
                    onCouncil: () =>
                      void act(`council:${t.id}`, async () => {
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
                      setTab("changes");
                      setMonitorOpen(true);
                    },
                  }}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* The composer floats over the end of the chat. */}
      {!away && !copy && (
        <form
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgb(7_8_12/0.85)_40%)] px-3 pt-10 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !running) void send(text);
          }}
        >
          <div className="pointer-events-auto mx-auto flex max-w-[780px] flex-col gap-2.5">
            {!running && turns.length > 0 && (
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {QUICK.map((q) => (
                  <button key={q.label} type="button" disabled={!!busy} onClick={() => void send(q.prompt)} className="glass-quiet shrink-0 rounded-full px-3 py-1.5 text-[12.5px] text-silk-2 transition-colors hover:text-silk disabled:opacity-40">
                    {q.label}
                  </button>
                ))}
              </div>
            )}
            <div className="glass rounded-[24px]">
              <label htmlFor="talkback" className="sr-only">
                Message to {AGENT_NAME[agent]}
              </label>
              <textarea
                id="talkback"
                ref={box}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !onPhone) {
                    e.preventDefault();
                    if (text.trim() && !running) void send(text);
                  }
                }}
                rows={Math.min(8, Math.max(1, text.split("\n").length))}
                placeholder={running ? `${AGENT_NAME[session.agent]} is working. Type your next message.` : `Reply to ${AGENT_NAME[agent]}…`}
                className="block max-h-[40dvh] w-full resize-none bg-transparent px-5 pt-4 pb-1 text-[16px] leading-relaxed outline-none placeholder:text-silk-3"
              />
              <div className="flex items-center gap-2 px-2.5 pb-2.5">
                <div role="radiogroup" aria-label="Agent" className="inline-flex rounded-full bg-black/25 p-[3px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
                  {(["claude", "codex"] as AgentId[]).map((a) => (
                    <button key={a} type="button" role="radio" aria-checked={agent === a} aria-label={AGENT_NAME[a]} disabled={!!state && !installed.includes(a)} onClick={() => setAgent(a)} className={cx("flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-35", agent === a ? "bg-white/[0.12] text-silk" : "text-silk-3 hover:text-silk")}>
                      <AgentDot agent={a} />
                      <span className="max-sm:hidden">{a === "claude" ? "Claude" : "Codex"}</span>
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
                  title={`Which model ${AGENT_NAME[agent]} uses. Empty means its own default. Saved for every chat.`}
                  placeholder="model"
                  className="hidden min-h-8 w-[110px] rounded-full bg-black/25 px-3 font-mono text-[12px] text-silk-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] outline-none placeholder:font-sans placeholder:text-silk-3 focus:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)] md:block"
                />
                <datalist id={`models-${agent}`}>
                  {(suggest[agent] ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {running ? (
                  <button type="button" aria-label="Stop" onClick={() => void act("stop", () => api(`/api/sessions/${id}/stop`, { body: {} }))} className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.1] text-silk shadow-[inset_0_0_0_1px_rgb(255_255_255/0.15)] transition-transform active:scale-95">
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : (
                  <button type="submit" aria-label="Send" disabled={!text.trim() || busy === "send"} className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,#fff,#e9e4dc)] text-desk shadow-[0_6px_18px_-6px_rgb(246_211_168/0.6)] transition-[transform,opacity] active:scale-95 disabled:opacity-35">
                    {busy === "send" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" />}
                  </button>
                )}
              </div>
            </div>
            {actionError && <p className="px-2 text-[13.5px] text-clip">{actionError}</p>}
          </div>
        </form>
      )}

      {/* Changes, the running app, saving and notes: a sheet from the side (from the bottom on a phone). */}
      {monitorOpen && <button type="button" aria-label="Close" className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]" onClick={() => setMonitorOpen(false)} />}
      <aside aria-hidden={!monitorOpen} className={cx("glass fixed z-50 flex min-h-0 flex-col transition-transform duration-[460ms] ease-[var(--ease-spring)] max-md:inset-x-0 max-md:bottom-0 max-md:h-[86dvh] max-md:rounded-t-[26px] md:top-2 md:right-2 md:bottom-2 md:w-[min(560px,46vw)] md:rounded-[22px]", monitorOpen ? "translate-0" : "max-md:translate-y-[105%] md:translate-x-[110%]")} inert={!monitorOpen}>
        <span className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-white/15 md:hidden" aria-hidden />
        <div className="absolute top-2.5 right-2.5 z-10">
          <Button size="sm" tone="quiet" onClick={() => setMonitorOpen(false)} aria-label="Close" icon={<X className="h-4 w-4" />} />
        </div>
        <Monitor version={version} session={session} run={data.run} tab={tab} setTab={setTab} busy={busy} diff={diff} setDiff={setDiff} onFix={() => void act("fix", () => api(`/api/sessions/${id}/run/fix`, { body: {} }))} />
      </aside>

      {sending && <SendToServer session={id} onClose={() => setSending(false)} onSent={() => void reload().then(refreshState)} />}
      {running && <span className="sr-only" role="status">{AGENT_NAME[session.agent]} is working</span>}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger, disabled, className }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cx("flex min-h-10 items-center gap-2.5 rounded-[11px] px-3 text-left text-[14px] transition-colors hover:bg-white/[0.07] disabled:opacity-40", danger ? "text-clip" : "text-silk", className)}>
      <span className={danger ? "text-clip" : "text-silk-3"}>{icon}</span>
      {children}
    </button>
  );
}
