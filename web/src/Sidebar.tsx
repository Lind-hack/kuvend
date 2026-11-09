import { LoaderCircle, Plus, Server, Settings2, Smartphone, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, onPhone, type AppState, type Chat, type Peer, type SessionSummary } from "./api";
import { AgentDot, ago, cx, Led, Mark } from "./ui";

const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

// Your terminal chats (Claude Code and Codex, from the CLI or their apps), newest first. Opening one
// continues that exact chat in Kuvend, with its whole history.
export function useChats(enabled = true) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const load = useCallback(() => {
    api<{ chats: Chat[] }>("/api/chats")
      .then((r) => setChats(r.chats))
      .catch(() => setChats((c) => c ?? []));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [enabled, load]);
  return { chats, reload: load };
}

export async function openChat(c: Chat): Promise<string> {
  if (c.session) return c.session;
  const r = await api<{ id: string }>("/api/chats/import", { body: { agent: c.agent, id: c.id } });
  return r.id;
}

export type Sheet = "phone" | "server" | "settings" | null;

export function Sidebar({ state, current, currentRunning, onOpen, onHome, onSheet, onClose }: { state: AppState | null; current: string | null; currentRunning: boolean; onOpen: (id: string) => void; onHome: () => void; onSheet: (s: Sheet) => void; onClose?: () => void }) {
  const { chats, reload } = useChats();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fresh = (chats ?? []).filter((c) => !c.session).slice(0, 40);

  async function open(c: Chat) {
    setOpening(c.id);
    setError("");
    try {
      onOpen(await openChat(c));
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setOpening(null);
  }

  return (
    <nav aria-label="Kuvend" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <button type="button" onClick={onHome} className="flex min-w-0 items-center gap-2.5 rounded-[10px]" aria-label="Kuvend home">
          <Mark />
          <span className="display text-[23px] leading-none">Kuvend</span>
        </button>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-9 w-9 place-items-center rounded-full text-silk-2 hover:bg-white/[0.07]">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="px-3 pb-3">
        <button type="button" onClick={onHome} className="flex min-h-10 w-full items-center gap-2 rounded-[12px] px-3 text-[14px] text-silk shadow-[inset_0_0_0_1px_rgb(255_255_255/0.09)] transition-colors hover:bg-white/[0.05]">
          <Plus className="h-4 w-4 text-silk-2" aria-hidden /> New chat
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {(state?.sessions.some((s) => !(s.mirrorOf && (!s.mirrorOf.takenAt || s.sentTo))) ?? false) && (
          <section aria-labelledby="nav-kuvend">
            <h2 id="nav-kuvend" className="silk px-2 pt-2 pb-1.5">
              Chats
            </h2>
            <ul className="flex flex-col gap-px">
              {state!.sessions.filter((s) => !(s.mirrorOf && (!s.mirrorOf.takenAt || s.sentTo))).map((s) => {
                const on = s.id === current;
                const working = on ? currentRunning : s.running;
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => onOpen(s.id)} aria-current={on ? "page" : undefined} className={cx("group flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors", on ? "bg-white/[0.08] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]" : "hover:bg-white/[0.04]")}>
                      <AgentDot agent={s.agent} className="mt-[7px]" />
                      <span className="min-w-0 flex-1">
                        <span className={cx("block truncate text-[14px]", on ? "text-silk" : "text-silk-2 group-hover:text-silk")}>{s.title}</span>
                        <span className="block truncate text-[12px] text-silk-3">
                          {s.sentTo ? `On ${s.sentTo.name}` : folder(s.project)} · {ago(s.updatedAt)}
                        </span>
                      </span>
                      {working && <Led color="var(--color-dawn)" blink label="Working" />}
                      {s.sentTo && <Server className="mt-1 h-3.5 w-3.5 shrink-0 text-silk-3" aria-label={`Continues on ${s.sentTo.name}`} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <PeerSections state={state} current={current} onOpen={onOpen} />

        {/* Your own computer's terminal chats only: a phone sees the computer's list the same way. */}
        <section aria-labelledby="nav-terminal" className="mt-4">
          <h2 id="nav-terminal" className="silk flex items-center gap-1.5 px-2 pt-2 pb-1.5">
            <SquareTerminal className="h-3.5 w-3.5" aria-hidden /> From your terminal
          </h2>
          {chats === null ? (
            <LoaderCircle className="mx-2.5 my-2 h-4 w-4 animate-spin text-silk-3" aria-label="Finding your chats" />
          ) : fresh.length === 0 ? (
            <p className="px-2.5 py-1 text-[12.5px] text-silk-3">Claude Code and Codex chats on {onPhone ? "your computer" : "this computer"} show up here.</p>
          ) : (
            <ul className="flex flex-col gap-px">
              {fresh.map((c) => (
                <li key={`${c.agent}:${c.id}`}>
                  <button type="button" disabled={!c.here || !!opening} onClick={() => void open(c)} title={c.here ? `Continue this chat, with its whole history (${c.cwd})` : `Its folder isn't here anymore (${c.cwd})`} className="group flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-45">
                    <AgentDot agent={c.agent} className="mt-[7px] opacity-70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-silk-2 group-hover:text-silk">{c.title}</span>
                      <span className="block truncate text-[12px] text-silk-3">
                        {folder(c.cwd)} · {ago(c.updatedAt)}
                      </span>
                    </span>
                    {opening === c.id && <LoaderCircle className="mt-1 h-3.5 w-3.5 animate-spin text-silk-3" aria-label="Opening" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="px-2.5 pt-1 text-[12.5px] text-clip">{error}</p>}
        </section>
      </div>

      <div className="flex items-center gap-1 border-t border-rule px-2 py-2">
        {!onPhone && (
          <FootButton onClick={() => onSheet("phone")} icon={<Smartphone className="h-4 w-4" />}>
            Phone
          </FootButton>
        )}
        <FootButton onClick={() => onSheet("server")} icon={<Server className="h-4 w-4" />}>
          Server
        </FootButton>
        <FootButton onClick={() => onSheet("settings")} icon={<Settings2 className="h-4 w-4" />}>
          Setup
        </FootButton>
      </div>
      <p className="flex items-center gap-1.5 px-4 pb-3 text-[11.5px] text-silk-3">
        <Led color="var(--color-go)" />
        <span className="truncate">{onPhone ? `Connected to ${state?.machine ?? "your computer"}` : `Running on ${state?.machine ?? "this computer"}`}</span>
      </p>
    </nav>
  );
}

function FootButton({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[12.5px] text-silk-2 transition-colors hover:bg-white/[0.06] hover:text-silk">
      {icon}
      {children}
    </button>
  );
}

// Each connected computer: its live chats while it's on (opened through this one); while it's off, the
// copies this machine keeps of them, ready to continue here.
function PeerSections({ state, current, onOpen }: { state: AppState | null; current: string | null; onOpen: (id: string) => void }) {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    api<{ peers: Peer[] }>("/api/peers")
      .then((r) => setPeers(r.peers))
      .catch(() => {});
  }, []);
  // Copies of a computer this one has no link to (the link back never happened, e.g. its phone access ran
  // through a Cloudflare tunnel): still listed, so they can be continued with that computer off.
  const linked = new Set(peers.map((p) => p.name));
  const loose = (state?.sessions ?? []).filter((s) => s.mirrorOf && !s.mirrorOf.takenAt && !linked.has(s.mirrorOf.name));
  const names = [...new Set(loose.map((s) => s.mirrorOf!.name))];
  return (
    <>
      {peers.map((p) => (
        <PeerSection key={p.id} peer={p} state={state} current={current} onOpen={onOpen} />
      ))}
      {names.map((name) => (
        <section key={name} aria-labelledby={`nav-copy-${name}`} className="mt-4">
          <h2 id={`nav-copy-${name}`} className="silk flex items-center gap-1.5 px-2 pt-2 pb-1.5">
            Copies from {name}
          </h2>
          <ul className="flex flex-col gap-px">
            {loose
              .filter((s) => s.mirrorOf!.name === name)
              .slice(0, 30)
              .map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => onOpen(s.id)} aria-current={s.id === current ? "page" : undefined} className={cx("group flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors", s.id === current ? "bg-white/[0.08] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]" : "hover:bg-white/[0.04]")}>
                    <AgentDot agent={s.agent} className="mt-[7px]" />
                    <span className="min-w-0 flex-1">
                      <span className={cx("block truncate text-[14px]", s.id === current ? "text-silk" : "text-silk-2 group-hover:text-silk")}>{s.title}</span>
                      <span className="block truncate text-[12px] text-silk-3">copy, continue here · {ago(s.updatedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function PeerSection({ peer, state, current, onOpen }: { peer: Peer; state: AppState | null; current: string | null; onOpen: (id: string) => void }) {
  const [live, setLive] = useState<{ sessions: SessionSummary[]; machine: string } | "down" | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      api<{ sessions: SessionSummary[]; machine: string }>(`/api/peers/${peer.id}/state`)
        .then((r) => !stop && setLive(r))
        .catch(() => !stop && setLive("down"));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [peer.id]);
  const me = state?.machine;
  // Online: its chats, minus the copies it keeps of this machine's own chats.
  const online = live && live !== "down" ? live.sessions.filter((s) => !(s.mirrorOf && s.mirrorOf.name === me && !s.mirrorOf.takenAt) && s.sentTo?.name !== me) : [];
  // Offline: the copies kept here.
  const copies = (state?.sessions ?? []).filter((s) => s.mirrorOf && !s.mirrorOf.takenAt && s.mirrorOf.name === peer.name);
  const items: { key: string; s: SessionSummary; note: string }[] = live === "down" ? copies.map((s) => ({ key: s.id, s, note: "copy, continue here" })) : online.map((s) => ({ key: `${peer.id}:${s.id}`, s, note: s.mirrorOf?.takenAt ? `taken over from ${s.mirrorOf.name}` : "" }));
  if (live === null && copies.length === 0) return null;
  return (
    <section aria-labelledby={`nav-${peer.id}`} className="mt-4">
      <h2 id={`nav-${peer.id}`} className="silk flex items-center gap-1.5 px-2 pt-2 pb-1.5">
        <Led color={live === "down" ? "var(--color-silk-3)" : "var(--color-go)"} on={live !== "down"} label={live === "down" ? "Off" : "On"} />
        On {peer.name}
        {live === "down" && <span className="text-silk-3">, off right now</span>}
      </h2>
      {items.length === 0 ? (
        <p className="px-2.5 py-1 text-[12.5px] text-silk-3">{live === "down" ? "No copies of its chats here yet." : "No chats there yet."}</p>
      ) : (
        <ul className="flex flex-col gap-px">
          {items.slice(0, 30).map(({ key, s, note }) => {
            const on = key === current;
            return (
              <li key={key}>
                <button type="button" onClick={() => onOpen(key)} aria-current={on ? "page" : undefined} className={cx("group flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors", on ? "bg-white/[0.08] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]" : "hover:bg-white/[0.04]")}>
                  <AgentDot agent={s.agent} className="mt-[7px]" />
                  <span className="min-w-0 flex-1">
                    <span className={cx("block truncate text-[14px]", on ? "text-silk" : "text-silk-2 group-hover:text-silk")}>{s.title}</span>
                    <span className="block truncate text-[12px] text-silk-3">
                      {note || folder(s.project)} · {ago(s.updatedAt)}
                    </span>
                  </span>
                  {s.running && <Led color="var(--color-dawn)" blink label="Working" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
