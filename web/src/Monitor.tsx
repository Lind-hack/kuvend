import { ArrowLeft, ExternalLink, GitMerge, LoaderCircle, Play, ShieldAlert, ShieldCheck, Square, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type FileChange, type RunState, type Session, type Warning } from "./api";
import { FileMeters } from "./Take";
import { Button, cx, Led } from "./ui";

export type Tab = "changes" | "run" | "save" | "notes";

// One file's diff as a gutter of + and − with tabular line text.
export function DiffView({ sessionId, from, to, file, onBack }: { sessionId: string; from: string; to: string; file: FileChange; onBack: () => void }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setDiff(null);
    api<{ diff: string }>(`/api/sessions/${sessionId}/diff?from=${from}&to=${to}&file=${encodeURIComponent(file.path)}`)
      .then((r) => setDiff(r.diff))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sessionId, from, to, file.path]);
  const lines = (diff ?? "").split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to))/.test(l));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <Button size="sm" tone="quiet" onClick={onBack} icon={<ArrowLeft className="h-3.5 w-3.5" />}>
          Files
        </Button>
        <span className="min-w-0 truncate font-mono text-[12.5px]">{file.path}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-desk">
        {error && <p className="p-3 text-[13px] text-clip">{error}</p>}
        {diff === null && !error && <LoaderCircle className="m-3 h-4 w-4 animate-spin text-silk-3" aria-label="Loading" />}
        {diff !== null && (
          <pre className="min-w-max py-2 font-mono text-[12.5px] leading-[1.6]">
            {lines.map((l, i) => (
              <div
                key={i}
                className={cx(
                  "px-3",
                  l.startsWith("@@") && "mt-2 bg-panel-2 text-silk-3",
                  l.startsWith("+") && "bg-go/[0.09] text-[#bfe8c8]",
                  l.startsWith("-") && "bg-clip/[0.1] text-[#f2b9ad]",
                  !/^[-+@]/.test(l) && "text-silk-2",
                )}
              >
                {l || " "}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

function Changes({ session, version, openFile }: { session: Session; version: number; openFile: (f: FileChange, from: string, to: string) => void }) {
  const [data, setData] = useState<{ from: string | null; to: string | null; files: FileChange[] } | null>(null);
  // Re-read whenever a take finishes, is dropped or comes back.
  const key = session.turns.map((t) => `${t.id}:${t.status}:${t.after ?? ""}:${t.undone ? 1 : 0}`).join(",");
  useEffect(() => {
    api<{ from: string | null; to: string | null; files: FileChange[] }>(`/api/sessions/${session.id}/changes`)
      .then(setData)
      .catch(() => setData({ from: null, to: null, files: [] }));
  }, [session.id, key, version]);
  if (!data) return <LoaderCircle className="m-4 h-4 w-4 animate-spin text-silk-3" aria-label="Loading" />;
  if (!data.files.length)
    return <p className="p-4 text-[14px] text-silk-2">{data.from ? "Nothing changed since this session started." : "Changes show here once an agent edits your files."}</p>;
  const added = data.files.reduce((n, f) => n + f.added, 0);
  const removed = data.files.reduce((n, f) => n + f.removed, 0);
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="px-1.5 text-[13.5px] text-silk-2">
        Since this session started: {data.files.length} {data.files.length === 1 ? "file" : "files"}, <span className="font-mono text-go">+{added}</span> <span className="font-mono text-clip">−{removed}</span>
      </p>
      <FileMeters files={data.files} onOpen={(f) => openFile(f, data.from!, data.to!)} />
    </div>
  );
}

function Run({ session, run, onFix, busy }: { session: Session; run: RunState; onFix: () => void; busy: string }) {
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const lines = run.lines;
  const hasError = lines.some((l) => l.error);

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  async function start() {
    setWorking(true);
    setError("");
    try {
      await api(`/api/sessions/${session.id}/run`, { body: { command: custom } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setWorking(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-rule p-3">
        <div className="flex flex-wrap items-center gap-2">
          {run.running ? (
            <Button size="sm" tone="danger" onClick={() => void api(`/api/sessions/${session.id}/run/stop`, { body: {} })} icon={<Square className="h-3 w-3 fill-current" />}>
              Stop the app
            </Button>
          ) : (
            <Button size="sm" tone="primary" disabled={working} onClick={() => void start()} icon={working ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}>
              Run the app
            </Button>
          )}
          {run.url && (
            <a href={run.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-[5px] px-2 font-mono text-[12.5px] text-codex hover:underline">
              {run.url.replace(/^https?:\/\//, "")} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-[12.5px] text-silk-3">
            <Led on={run.running} color={hasError ? "var(--color-clip)" : "var(--color-go)"} blink={run.installing} />
            {run.installing ? "installing" : run.running ? "running" : run.exitCode !== null ? `stopped (${run.exitCode})` : "off"}
          </span>
        </div>
        {!run.running && (
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={run.command ?? "Start command (leave empty to detect it)"}
            aria-label="Start command"
            className="min-h-9 rounded-[4px] border border-rule bg-desk px-2.5 font-mono text-[12.5px] outline-none placeholder:text-silk-3 focus:border-silk-3"
          />
        )}
        {error && <p className="text-[13px] text-clip">{error}</p>}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-desk py-2" aria-live="polite">
        {lines.length === 0 ? (
          <p className="px-3 text-[13.5px] text-silk-3">Your app's output shows here. Errors light up red, and one tap sends them to the agent.</p>
        ) : (
          <pre className="font-mono text-[12px] leading-[1.6]">
            {lines.map((l, i) => (
              <div key={i} className={cx("px-3 whitespace-pre-wrap", l.error ? "bg-clip/[0.08] text-[#f2b9ad]" : "text-silk-2")} style={{ overflowWrap: "anywhere" }}>
                {l.text}
              </div>
            ))}
          </pre>
        )}
      </div>
      {hasError && (
        <div className="border-t border-clip/40 bg-clip/[0.06] p-3">
          <Button tone="primary" className="w-full" disabled={!!busy} onClick={onFix} icon={<Wrench className="h-4 w-4" />}>
            Send this error to the agent
          </Button>
        </div>
      )}
    </div>
  );
}

function Save({ session }: { session: Session }) {
  const [check, setCheck] = useState<{ files: string[]; warnings: Warning[]; branch: string | null } | null>(null);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "saving" | "saved" | "merging" | "merged">("idle");
  const [error, setError] = useState("");
  const [override, setOverride] = useState(false);
  const stops = check?.warnings.filter((w) => w.level === "stop") ?? [];

  async function runCheck() {
    setState("checking");
    setError("");
    setOverride(false);
    try {
      const c = await api<{ files: string[]; warnings: Warning[]; branch: string | null }>(`/api/sessions/${session.id}/save/check`, { body: {} });
      setCheck(c);
      if (!message) setMessage(session.turns.filter((t) => t.kind === "chat").at(-1)?.prompt.split("\n")[0].slice(0, 72) ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setState("idle");
  }

  async function save() {
    setState("saving");
    setError("");
    try {
      await api(`/api/sessions/${session.id}/save`, { body: { message } });
      setState("saved");
      setCheck(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  async function merge() {
    setState("merging");
    setError("");
    try {
      await api(`/api/sessions/${session.id}/merge`, { body: {} });
      setState("merged");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-[14px] text-silk-2">Saving records every change as one commit in git. Kuvend checks the changes first for keys, passwords and files that shouldn't be shared.</p>
      {!check ? (
        <Button tone="primary" disabled={state === "checking"} onClick={() => void runCheck()} icon={state === "checking" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}>
          Check before saving
        </Button>
      ) : check.files.length === 0 ? (
        <p className="text-[14px]">There's nothing new to save.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-[5px] border border-rule bg-desk px-3 py-2.5">
            {/* The clip light: red when something must not be saved. */}
            <Led color={stops.length ? "var(--color-clip)" : check.warnings.length ? "var(--color-warn)" : "var(--color-go)"} label="Check result" />
            <span className="text-[14px] font-medium">{stops.length ? `${stops.length} thing${stops.length > 1 ? "s" : ""} to fix first` : check.warnings.length ? "Worth a look" : "Clean"}</span>
            <span className="ml-auto font-mono text-[12px] text-silk-3">{check.files.length} files</span>
          </div>
          {check.warnings.map((w, i) => (
            <div key={i} className={cx("flex gap-2.5 rounded-[5px] border p-3", w.level === "stop" ? "border-clip/45 bg-clip/[0.07]" : "border-warn/40 bg-warn/[0.05]")}>
              <ShieldAlert className={cx("mt-0.5 h-4 w-4 shrink-0", w.level === "stop" ? "text-clip" : "text-warn")} aria-hidden />
              <span className="text-[13.5px]">
                <span className="font-medium">{w.title}</span>
                <span className="block text-silk-2">{w.detail}</span>
              </span>
            </div>
          ))}
          {stops.length > 0 && (
            <label className="flex items-center gap-2 text-[13px] text-silk-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-clip)]" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              I checked these and want to save anyway
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="silk">What changed, in a sentence</span>
            <input value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-10 rounded-[5px] border border-rule bg-desk px-3 text-[14px] outline-none focus:border-silk-3" />
          </label>
          <div className="flex gap-2">
            <Button tone="quiet" onClick={() => void runCheck()}>
              Check again
            </Button>
            <Button tone="primary" className="flex-1" disabled={!message.trim() || state === "saving" || (stops.length > 0 && !override)} onClick={() => void save()} icon={state === "saving" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : undefined}>
              Save to {check.branch ?? "git"}
            </Button>
          </div>
        </div>
      )}
      {state === "saved" && <p className="flex items-center gap-2 text-[14px] text-go">Saved.</p>}
      {session.branch && (
        <div className="flex flex-col gap-2 border-t border-rule pt-4">
          <p className="text-[14px] text-silk-2">
            This session works on a safe copy, branch <span className="font-mono text-silk">{session.branch}</span>. When it's right, bring it back into your project.
          </p>
          <Button disabled={state === "merging"} onClick={() => void merge()} icon={state === "merging" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}>
            Bring the copy back
          </Button>
          {state === "merged" && <p className="text-[14px] text-go">Done. Your project has the changes now.</p>}
        </div>
      )}
      {error && <p className="rounded-[5px] border border-clip/40 bg-clip/[0.07] px-3 py-2 text-[13.5px] text-clip">{error}</p>}
    </div>
  );
}

// Project notes: what every agent reads first (AGENTS.md, shared with Claude Code through CLAUDE.md).
function Notes({ dir }: { dir: string }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ text: string }>("/api/project/notes", { body: { path: dir } })
      .then((r) => setText(r.text))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [dir]);
  async function save() {
    try {
      await api("/api/project/notes", { body: { path: dir, text } });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <p className="text-[14px] text-silk-2">Both agents read these notes before every message. Write what they should always know: what the project is, how to run it, what not to touch.</p>
      {text === null ? (
        <LoaderCircle className="h-4 w-4 animate-spin text-silk-3" aria-label="Loading" />
      ) : (
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          aria-label="Project notes"
          placeholder={"This is a recipe app built with Next.js.\nRun it with npm run dev.\nNever change the database schema without asking."}
          className="min-h-64 flex-1 resize-none rounded-[5px] border border-rule bg-desk p-3 font-mono text-[13px] leading-relaxed outline-none placeholder:text-silk-3 focus:border-silk-3"
        />
      )}
      {error && <p className="text-[13px] text-clip">{error}</p>}
      <Button tone="primary" disabled={saved || text === null} onClick={() => void save()}>
        {saved ? "Notes saved" : "Save notes"}
      </Button>
    </div>
  );
}

export function Monitor({ version, session, run, tab, setTab, onFix, busy, diff, setDiff }: { version: number; session: Session; run: RunState; tab: Tab; setTab: (t: Tab) => void; onFix: () => void; busy: string; diff: { file: FileChange; from: string; to: string } | null; setDiff: (d: { file: FileChange; from: string; to: string } | null) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "changes", label: "Changes" },
    { key: "run", label: "Run" },
    { key: "save", label: "Save" },
    { key: "notes", label: "Notes" },
  ];
  return (
    <section aria-label="Monitor" className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Monitor" className="flex gap-1 border-b border-rule px-2 pt-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setDiff(null);
            }}
            className={cx("font-label relative flex min-h-10 items-center gap-1.5 px-3 text-[14px] font-semibold transition-colors", tab === t.key ? "text-silk" : "text-silk-3 hover:text-silk-2")}
          >
            {t.label}
            {t.key === "run" && run.running && <Led color={run.lines.some((l) => l.error) ? "var(--color-clip)" : "var(--color-go)"} />}
            {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-[2px] bg-warn" aria-hidden />}
          </button>
        ))}
      </div>
      {diff ? (
        <DiffView sessionId={session.id} from={diff.from} to={diff.to} file={diff.file} onBack={() => setDiff(null)} />
      ) : tab === "changes" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <Changes session={session} version={version} openFile={(file, from, to) => setDiff({ file, from, to })} />
        </div>
      ) : tab === "run" ? (
        <Run session={session} run={run} onFix={onFix} busy={busy} />
      ) : tab === "save" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <Save session={session} />
        </div>
      ) : (
        <Notes dir={session.cwd} />
      )}
    </section>
  );
}
