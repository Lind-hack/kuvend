import { ArrowRight, Check, Copy, FolderOpen, GitBranch, History, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AGENT_NAME, api, type AgentId, type AppState, type Mode, type Project, type Session } from "./api";
import { ago, Button, CAP, cx, Led, ModeSwitch, Scribble, shortPath } from "./ui";

const INSTALL: Record<AgentId, { cmd: string; login: string }> = {
  claude: { cmd: "npm install -g @anthropic-ai/claude-code", login: "claude" },
  codex: { cmd: "npm install -g @openai/codex", login: "codex login" },
};

function CopyLine({ text }: { text: string }) {
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
      className="group flex w-full items-center justify-between gap-2 rounded-[4px] border border-rule bg-desk px-2.5 py-1.5 text-left font-mono text-[12.5px] text-silk-2 hover:border-rule-hi"
    >
      <span className="truncate">{text}</span>
      {done ? <Check className="h-3.5 w-3.5 shrink-0 text-go" aria-label="Copied" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-silk-3 group-hover:text-silk" aria-label="Copy" />}
    </button>
  );
}

// One channel strip per agent: is it installed, and if not, the two lines that fix it.
function ChannelCheck({ agent, info }: { agent: AgentId; info?: { installed: boolean; version?: string } }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-rule pt-3 first:border-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <Scribble agent={agent} />
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

function NewSession({ project, agents, onCancel, onStarted, onProject }: { project: Project; agents: AppState["agents"] | null; onCancel: () => void; onStarted: (s: Session) => void; onProject: (p: Project) => void }) {
  const firstReady = (["claude", "codex"] as AgentId[]).find((a) => agents?.[a]?.installed) ?? "claude";
  const [agent, setAgent] = useState<AgentId>(firstReady);
  const [mode, setMode] = useState<Mode>("edit");
  const [safeCopy, setSafeCopy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function start() {
    setBusy("start");
    setError("");
    try {
      onStarted(await api<Session>("/api/sessions", { body: { project: project.path, agent, mode, safeCopy, prompt } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  async function turnOnUndo() {
    setBusy("git");
    setError("");
    try {
      onProject(await api<Project>("/api/project/git-init", { body: { path: project.path } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  }

  return (
    <section aria-labelledby="new-title" className="take-in flex flex-col gap-5 rounded-[6px] border border-rule-hi bg-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="new-title" className="text-[22px] font-semibold tracking-[-0.01em]">
          {project.name}
        </h2>
        <span className="font-mono text-[12px] text-silk-3">{shortPath(project.path)}</span>
      </div>

      {!project.repo ? (
        <div className="flex flex-col gap-3 rounded-[5px] border border-warn/40 bg-warn/[0.06] p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-[14px] text-silk-2">
            <span className="font-medium text-silk">Undo is off for this folder.</span> Kuvend keeps a copy of your files before every turn using git. Turn it on and you can take back anything an agent does.
          </p>
          <Button tone="primary" onClick={() => void turnOnUndo()} disabled={!!busy} icon={busy === "git" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}>
            Turn on undo
          </Button>
        </div>
      ) : (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-silk-2">
          <span className="flex items-center gap-1.5">
            <Led /> Undo is on
          </span>
          {project.branch && (
            <span className="flex items-center gap-1.5 font-mono text-[12.5px]">
              <GitBranch className="h-3.5 w-3.5 text-silk-3" aria-hidden /> {project.branch}
            </span>
          )}
          {project.run && <span className="font-mono text-[12.5px] text-silk-3">runs with {project.run}</span>}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="silk mb-2">Channel</legend>
          <div className="flex gap-2">
            {(["claude", "codex"] as AgentId[]).map((a) => {
              const on = agent === a;
              const ok = agents?.[a]?.installed;
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  disabled={agents !== null && !ok}
                  onClick={() => setAgent(a)}
                  className={cx("flex min-h-11 flex-1 items-center gap-2 rounded-[5px] border px-3 text-left text-[14px] transition-colors disabled:opacity-40", on ? "border-transparent bg-panel-3" : "border-rule hover:border-rule-hi")}
                  style={on ? { boxShadow: `inset 0 0 0 1px ${CAP[a]}` } : undefined}
                >
                  <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: CAP[a] }} aria-hidden />
                  {AGENT_NAME[a]}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2">
          <span className="silk mb-2">What it may do</span>
          <ModeSwitch value={mode} onChange={setMode} />
        </div>
      </div>

      <label className={cx("flex items-start gap-3 rounded-[5px] border border-rule p-3", !project.commits && "opacity-55")}>
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-warn)]" checked={safeCopy} disabled={!project.commits} onChange={(e) => setSafeCopy(e.target.checked)} />
        <span className="text-[14px]">
          <span className="font-medium">Work on a safe copy</span>
          <span className="block text-silk-2">
            {project.commits ? "The agent works in a separate copy on its own branch. Your folder stays untouched until you bring the copy back." : "Needs at least one save (commit) in this project first."}
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-2">
        <span className="silk">First message (optional)</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="What do you want to build or fix?"
          className="w-full resize-y rounded-[5px] border border-rule bg-desk px-3 py-2.5 text-[15px] outline-none placeholder:text-silk-3 focus:border-silk-3"
        />
      </label>

      {error && <p className="rounded-[5px] border border-clip/40 bg-clip/[0.07] px-3 py-2 text-[14px] text-clip">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button tone="quiet" onClick={onCancel}>
          Back
        </Button>
        <Button tone="primary" onClick={() => void start()} disabled={!!busy} icon={busy === "start" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}>
          Start session
        </Button>
      </div>
    </section>
  );
}

export function Launch({ state, onOpen, initialProject }: { state: AppState | null; onOpen: (id: string) => void; initialProject?: string }) {
  const [picked, setPicked] = useState<Project | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function inspect(path: string) {
    setError("");
    try {
      setPicked(await api<Project>("/api/project/inspect", { body: { path } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (initialProject) void inspect(initialProject);
  }, [initialProject]);

  async function choose() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ path: string | null; project: Project | null }>("/api/pick-folder", { body: {} });
      if (r.project) setPicked(r.project);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto grid w-full max-w-[1120px] gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:py-16">
      <main className="flex min-w-0 flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-[clamp(30px,4vw,44px)] leading-[1.08] font-semibold tracking-[-0.025em]">Put your agents to work on a project.</h1>
          <p className="max-w-[58ch] text-[16px] text-silk-2">Every change is a take you can drop, the other agent can check it, and nothing is saved until it passes the check.</p>
        </header>

        {picked ? (
          <NewSession project={picked} agents={state?.agents ?? null} onCancel={() => setPicked(null)} onStarted={(s) => onOpen(s.id)} onProject={setPicked} />
        ) : (
          <section aria-label="Open a project" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button tone="primary" className="min-h-12 px-5 text-[15px]" onClick={() => void choose()} disabled={busy} icon={busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}>
                Choose a project folder
              </Button>
              <form
                className="flex min-w-0 flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typed.trim()) void inspect(typed.trim());
                }}
              >
                <label className="sr-only" htmlFor="path">
                  Or paste a folder path
                </label>
                <input
                  id="path"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="or paste a folder path"
                  className="min-h-12 min-w-0 flex-1 rounded-[5px] border border-rule bg-panel px-3 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-silk-3 focus:border-silk-3"
                />
                <Button type="submit" className="min-h-12" disabled={!typed.trim()}>
                  Open
                </Button>
              </form>
            </div>
            {error && <p className="text-[14px] text-clip">{error}</p>}

            {(state?.projects.length ?? 0) > 0 && (
              <div className="flex flex-col">
                <h2 className="silk mb-2">Recent projects</h2>
                <ul className="divide-y divide-rule overflow-hidden rounded-[6px] border border-rule bg-panel">
                  {state!.projects.map((p) => (
                    <li key={p.path}>
                      <button type="button" onClick={() => setPicked(p)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-panel-2">
                        <Led on={p.repo} color={p.repo ? "var(--color-go)" : "var(--color-warn)"} label={p.repo ? "Undo on" : "Undo off"} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium">{p.name}</span>
                          <span className="block truncate font-mono text-[12px] text-silk-3">{shortPath(p.path)}</span>
                        </span>
                        {p.branch && <span className="hidden font-mono text-[12px] text-silk-3 sm:inline">{p.branch}</span>}
                        <ArrowRight className="h-4 w-4 shrink-0 text-silk-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {(state?.sessions.length ?? 0) > 0 && (
          <section aria-label="Earlier sessions" className="flex flex-col">
            <h2 className="silk mb-2 flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" aria-hidden /> Earlier sessions
            </h2>
            <ul className="divide-y divide-rule overflow-hidden rounded-[6px] border border-rule bg-panel">
              {state!.sessions.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-panel-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: CAP[s.agent] }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{s.title}</span>
                      <span className="block truncate font-mono text-[12px] text-silk-3">
                        {shortPath(s.project).split(/[\\/]/).pop()} · {s.turns} {s.turns === 1 ? "take" : "takes"}
                      </span>
                    </span>
                    {s.running && <Led color="var(--color-clip)" blink label="Working" />}
                    <span className="shrink-0 text-[12.5px] text-silk-3">{ago(s.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <aside aria-label="Channels" className="flex h-fit flex-col gap-4 rounded-[6px] border border-rule bg-panel p-4">
        <h2 className="silk">Channels on this computer</h2>
        <ChannelCheck agent="claude" info={state?.agents.claude} />
        <ChannelCheck agent="codex" info={state?.agents.codex} />
        <p className="border-t border-rule pt-3 text-[13px] text-silk-3">Kuvend runs the agents you already have, signed in as you. It never sees your logins.</p>
        <CouncilLink />
      </aside>
    </div>
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
  return (
    <div className="flex flex-col gap-2.5 border-t border-rule pt-3">
      <h3 className="text-[14px] font-medium">The council</h3>
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
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-dashboard" aria-label="Dashboard address" className="min-h-9 rounded-[4px] border border-rule bg-desk px-2.5 font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-silk-3 focus:border-silk-3" />
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Link code (kvd_…)" aria-label="Link code" type="password" className="min-h-9 rounded-[4px] border border-rule bg-desk px-2.5 font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-silk-3 focus:border-silk-3" />
          <Button size="sm" disabled={busy || !url.trim() || !code.trim()} onClick={() => void save()} icon={busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            Link
          </Button>
          {error && <p className="text-[13px] text-clip">{error}</p>}
        </>
      )}
    </div>
  );
}
