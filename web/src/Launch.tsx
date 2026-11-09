import { ArrowUp, Check, ChevronDown, Copy, FolderOpen, GitBranch, LoaderCircle, Menu, Settings2, ShieldCheck, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_NAME, api, onPhone, type AgentId, type AppState, type Chat, type Mode, type Project, type Session } from "./api";
import { openChat, useChats, type Sheet as SheetName } from "./Sidebar";
import { AgentDot, ago, Button, cx, Led, ModeSwitch, Sheet, shortPath } from "./ui";

const INSTALL: Record<AgentId, { cmd: string; login: string }> = {
  claude: { cmd: "npm install -g @anthropic-ai/claude-code", login: "claude" },
  codex: { cmd: "npm install -g @openai/codex", login: "codex login" },
};

export function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="group flex w-full items-center justify-between gap-2 rounded-[10px] bg-black/25 px-3 py-2 text-left font-mono text-[12.5px] text-silk-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] hover:text-silk"
    >
      <span className="truncate">{text}</span>
      {done ? <Check className="h-3.5 w-3.5 shrink-0 text-go" aria-label="Copied" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-silk-3 group-hover:text-silk" aria-label="Copy" />}
    </button>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Working late." : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
};
const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

// Which project the next chat works in: recent ones, the folder picker (on the computer), or a path.
function ProjectPicker({ projects, value, onPick, onError }: { projects: Project[]; value: Project | null; onPick: (p: Project) => void; onError: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", off);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("mousedown", off);
      removeEventListener("keydown", esc);
    };
  }, [open]);
  async function run(fn: () => Promise<Project | null>) {
    setBusy(true);
    onError("");
    try {
      const p = await fn();
      if (p) {
        onPick(p);
        setOpen(false);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-9 max-w-[220px] items-center gap-2 rounded-full bg-white/[0.06] px-3.5 text-[13px] text-silk shadow-[inset_0_0_0_1px_rgb(255_255_255/0.09)] transition-colors hover:bg-white/[0.1]">
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-silk-2" aria-hidden />
        <span className="truncate">{value ? value.name : "Choose a project"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-silk-3" aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a project" className="glass take-in absolute bottom-[calc(100%+10px)] left-0 z-30 w-[min(360px,82vw)] rounded-[18px] p-2">
          {!onPhone && (
            <button type="button" disabled={busy} onClick={() => void run(async () => (await api<{ project: Project | null }>("/api/pick-folder", { body: {} })).project)} className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[14px] hover:bg-white/[0.07]">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4 text-silk-2" />} Choose a folder…
            </button>
          )}
          {projects.length > 0 && <p className="silk px-3 pt-2 pb-1">Recent</p>}
          <ul className="max-h-[240px] overflow-y-auto">
            {projects.map((p) => (
              <li key={p.path}>
                <button type="button" onClick={() => (onPick(p), setOpen(false))} className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left hover:bg-white/[0.07]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{p.name}</span>
                    <span className="block truncate font-mono text-[11.5px] text-silk-3">{shortPath(p.path)}</span>
                  </span>
                  {value?.path === p.path && <Check className="h-4 w-4 text-dawn" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-1 flex gap-1.5 border-t border-rule p-1.5 pt-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) void run(() => api<Project>("/api/project/inspect", { body: { path: typed.trim() } }));
            }}
          >
            <label htmlFor="path" className="sr-only">
              Folder path
            </label>
            <input id="path" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="or paste a folder path" className="min-h-9 min-w-0 flex-1 rounded-[10px] bg-black/25 px-2.5 font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-silk-3 focus:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]" />
            <Button size="sm" type="submit" disabled={!typed.trim() || busy}>
              Open
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

type Recent = { key: string; title: string; where: string; at: string; agent: AgentId; tag: string | null; open: () => Promise<string> };

export function Launch({ state, onOpen, initialProject, onNav, onSheet }: { state: AppState | null; onOpen: (id: string) => void; initialProject?: string; onNav: () => void; onSheet: (s: SheetName) => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const firstReady = (["claude", "codex"] as AgentId[]).find((a) => state?.agents?.[a]?.installed) ?? "claude";
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [safeCopy, setSafeCopy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { chats } = useChats();
  const who = agent ?? firstReady;

  useEffect(() => {
    if (initialProject) void api<Project>("/api/project/inspect", { body: { path: initialProject } }).then(setProject).catch(() => {});
  }, [initialProject]);
  useEffect(() => {
    if (!project && state?.projects[0]) setProject(state.projects[0]);
  }, [state, project]);

  const recents = useMemo<Recent[]>(() => {
    const list: Recent[] = (state?.sessions ?? []).filter((s) => !(s.mirrorOf && (!s.mirrorOf.takenAt || s.sentTo))).slice(0, 12).map((s) => ({ key: s.id, title: s.title, where: s.sentTo ? `on ${s.sentTo.name}` : folder(s.project), at: s.updatedAt, agent: s.agent, tag: s.from === "terminal" ? "terminal" : s.from ? `from ${s.from}` : null, open: async () => s.id }));
    for (const c of (chats ?? []).filter((c: Chat) => !c.session && c.here).slice(0, 12)) list.push({ key: c.id, title: c.title, where: folder(c.cwd), at: c.updatedAt, agent: c.agent, tag: "terminal", open: () => openChat(c) });
    return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [state, chats]);

  async function start() {
    if (!project) return setError("Choose a project first.");
    setBusy("start");
    setError("");
    try {
      onOpen((await api<Session>("/api/sessions", { body: { project: project.path, agent: who, mode, safeCopy, prompt } })).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }
  async function turnOnUndo() {
    if (!project) return;
    setBusy("git");
    try {
      setProject(await api<Project>("/api/project/git-init", { body: { path: project.path } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  }
  const missing = state ? (["claude", "codex"] as AgentId[]).filter((a) => !state.agents[a]?.installed) : [];

  return (
    <div className="h-dvh overflow-y-auto">
      <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
        <Button tone="quiet" size="sm" aria-label="Chats" onClick={onNav} icon={<Menu className="h-4 w-4" />} />
      </div>
      <main className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-[760px] flex-col justify-center gap-10 px-4 pt-8 pb-16 sm:px-8 lg:min-h-dvh">
        <header className="rise flex flex-col gap-3">
          <p className="text-[14px] text-dawn/90">{greeting()}</p>
          <h1 className="display text-[clamp(44px,7vw,76px)]">What are we building?</h1>
        </header>

        <form
          className="rise glass flex flex-col rounded-[26px] [animation-delay:80ms]"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label htmlFor="first" className="sr-only">
            What you want {AGENT_NAME[who]} to do
          </label>
          <textarea
            id="first"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && prompt.trim()) {
                e.preventDefault();
                void start();
              }
            }}
            rows={3}
            placeholder={`Describe it to ${AGENT_NAME[who]}. A page, a fix, a whole app.`}
            className="block min-h-[112px] w-full resize-none bg-transparent px-5 pt-5 text-[17px] leading-relaxed outline-none placeholder:text-silk-3"
          />
          <div className="flex flex-wrap items-center gap-2 px-3 pt-1 pb-3">
            <ProjectPicker projects={state?.projects ?? []} value={project} onPick={setProject} onError={setError} />
            <div role="radiogroup" aria-label="Agent" className="inline-flex rounded-full bg-black/25 p-[3px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
              {(["claude", "codex"] as AgentId[]).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={who === a} disabled={!!state && !state.agents[a]?.installed} onClick={() => setAgent(a)} className={cx("flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors disabled:opacity-35", who === a ? "bg-white/[0.12] text-silk" : "text-silk-3 hover:text-silk")}>
                  <AgentDot agent={a} />
                  {a === "claude" ? "Claude" : "Codex"}
                </button>
              ))}
            </div>
            <ModeSwitch value={mode} onChange={setMode} />
            <button type="submit" aria-label="Start" disabled={!!busy || !project} className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-[linear-gradient(180deg,#fff,#e9e4dc)] text-desk shadow-[0_6px_18px_-6px_rgb(246_211_168/0.6)] transition-transform active:scale-95 disabled:opacity-40">
              {busy === "start" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" />}
            </button>
          </div>
          {project && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule px-5 py-3 text-[12.5px] text-silk-3">
              {project.repo ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <Led /> Undo is on
                  </span>
                  {project.branch && (
                    <span className="flex items-center gap-1 font-mono">
                      <GitBranch className="h-3.5 w-3.5" aria-hidden /> {project.branch}
                    </span>
                  )}
                  <label className={cx("flex items-center gap-2", !project.commits && "opacity-50")} title={project.commits ? "The agent works in a separate copy on its own branch; your folder stays untouched until you bring it back." : "Needs at least one commit first."}>
                    <input type="checkbox" className="h-3.5 w-3.5" checked={safeCopy} disabled={!project.commits} onChange={(e) => setSafeCopy(e.target.checked)} />
                    Work on a safe copy
                  </label>
                </>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <Led color="var(--color-warn)" /> Undo is off for this folder.
                  <button type="button" onClick={() => void turnOnUndo()} disabled={!!busy} className="inline-flex items-center gap-1 text-dawn hover:underline">
                    {busy === "git" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Turn it on
                  </button>
                </span>
              )}
              <span className="ml-auto hidden truncate font-mono sm:inline">{shortPath(project.path)}</span>
            </div>
          )}
        </form>
        {error && <p className="-mt-6 px-2 text-[14px] text-clip">{error}</p>}

        {missing.length > 0 && (
          <div className="plate flex flex-col gap-3 rounded-[18px] p-4">
            <p className="text-[14px] text-silk-2">
              {missing.map((a) => AGENT_NAME[a]).join(" and ")} {missing.length === 1 ? "isn't" : "aren't"} installed here yet.{" "}
              <button type="button" className="text-dawn hover:underline" onClick={() => onSheet("settings")}>
                Set {missing.length === 1 ? "it" : "them"} up
              </button>
            </p>
          </div>
        )}

        {recents.length > 0 && (
          <section aria-labelledby="continue" className="rise flex flex-col gap-2 [animation-delay:160ms]">
            <h2 id="continue" className="silk px-1">
              Continue
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {recents.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() =>
                      void r
                        .open()
                        .then(onOpen)
                        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                    }
                    className="plate group flex h-full w-full flex-col gap-2 rounded-[16px] p-4 text-left transition-[background-color,transform] duration-200 hover:bg-white/[0.05] active:scale-[0.99]"
                  >
                    <span className="flex items-center gap-2 text-[12px] text-silk-3">
                      <AgentDot agent={r.agent} />
                      <span className="truncate">{r.where}</span>
                      {r.tag && (
                        <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px]">
                          {r.tag === "terminal" && <SquareTerminal className="h-3 w-3" aria-hidden />}
                          {r.tag}
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-2 text-[15px] leading-snug text-silk-2 group-hover:text-silk">{r.title}</span>
                    <span className="mt-auto text-[12px] text-silk-3">{ago(r.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

// ---------- setup: the agents on this computer, and the optional council link ----------

function ChannelCheck({ agent, info }: { agent: AgentId; info?: { installed: boolean; version?: string } }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-rule pt-3 first:border-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[15px]">
          <AgentDot agent={agent} /> {AGENT_NAME[agent]}
        </span>
        {info ? (
          <span className="flex items-center gap-1.5 font-mono text-[12px] text-silk-3">
            <Led on={info.installed} color={info.installed ? "var(--color-go)" : "var(--color-clip)"} />
            {info.installed ? (info.version?.replace(/\s*\(.*\)/, "") ?? "ready") : "not found"}
          </span>
        ) : (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-silk-3" aria-label="Checking" />
        )}
      </div>
      {info && !info.installed && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] text-silk-2">Install it, then sign in once in a terminal:</p>
          <CopyLine text={INSTALL[agent].cmd} />
          <CopyLine text={INSTALL[agent].login} />
        </div>
      )}
    </div>
  );
}

export function Settings({ state, onClose }: { state: AppState | null; onClose: () => void }) {
  return (
    <Sheet title="Setup" icon={<Settings2 className="h-[18px] w-[18px]" />} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <section className="plate flex flex-col gap-3 rounded-[16px] p-4">
          <ChannelCheck agent="claude" info={state?.agents.claude} />
          <ChannelCheck agent="codex" info={state?.agents.codex} />
        </section>
        <p className="text-[13px] leading-relaxed text-silk-3">Kuvend runs the agents you already have, signed in as you, with your skills, MCP servers and hooks. It never sees your logins.</p>
        {!onPhone && <Autostart />}
        <CouncilLink />
      </div>
    </Sheet>
  );
}

// The optional link to an Agentic OS dashboard, whose Roast room can debate a take.
export function CouncilLink() {
  const [linked, setLinked] = useState<string | null | undefined>(undefined);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ council?: string | null }>("/api/settings")
      .then((s) => setLinked(s.council ?? null))
      .catch(() => setLinked(null));
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ url: string }>("/api/council/link", { body: { url, code } });
      setLinked(r.url);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }
  const field = "min-h-10 rounded-[12px] bg-black/25 px-3 font-mono text-[12.5px] outline-none shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] placeholder:font-sans placeholder:text-silk-3 focus:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]";
  return (
    <div className="flex flex-col gap-2.5 border-t border-rule pt-4">
      <h3 className="text-[15px] font-medium">The council</h3>
      {linked === undefined ? null : linked ? (
        <>
          <p className="flex items-center gap-1.5 text-[13px] text-silk-2">
            <Led /> Linked to <span className="truncate font-mono text-[12px]">{linked.replace(/^https?:\/\//, "")}</span>
          </p>
          <Button size="sm" tone="quiet" className="self-start" onClick={() => void api("/api/council/link", { method: "DELETE" }).then(() => setLinked(null))}>
            Unlink
          </Button>
        </>
      ) : (
        <>
          <p className="text-[13px] text-silk-3">Optional. Link your Agentic OS dashboard and any take can go to its Roast room: several AIs debate it and a judge rules.</p>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-dashboard" aria-label="Dashboard address" className={field} />
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Link code (kvd_…)" aria-label="Link code" type="password" className={field} />
          <Button size="sm" className="self-start" disabled={busy || !url.trim() || !code.trim()} onClick={() => void save()} icon={busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            Link
          </Button>
          {error && <p className="text-[13px] text-clip">{error}</p>}
        </>
      )}
    </div>
  );
}

// Start with the computer: Kuvend runs quietly in the background from login, so your phone and your server
// always find it.
function Autostart() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ on: boolean }>("/api/autostart")
      .then((r) => setOn(r.on))
      .catch(() => setOn(null));
  }, []);
  if (on === null) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={on}
          onChange={(e) =>
            void api<{ on: boolean }>("/api/autostart", { body: { on: e.target.checked } })
              .then((r) => (setOn(r.on), setError("")))
              .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          }
        />
        <span>
          <span className="block text-[15px] font-medium">Start with this computer</span>
          <span className="block text-[13px] text-silk-3">Kuvend starts quietly in the background when you log in, so your phone and your server can always reach it.</span>
        </span>
      </label>
      {error && <p className="text-[13px] text-clip">{error}</p>}
    </div>
  );
}
