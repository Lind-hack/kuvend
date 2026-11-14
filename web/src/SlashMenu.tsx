import { useEffect, useState, type KeyboardEvent } from "react";
import { api, AGENT_NAME, type AgentId } from "./api";
import { cx } from "./ui";

// Type "/" in a composer: the agent's own skills and commands (from the computer Kuvend runs on).
// Picking one types "/name "; the CLI runs it itself, as in a terminal.

export type Command = { name: string; description: string; kind: "skill" | "command" | "builtin" };

const cache = new Map<AgentId, Promise<Command[]>>();
const load = (agent: AgentId) => {
  if (!cache.has(agent))
    cache.set(
      agent,
      api<{ commands: Command[] }>(`/api/commands?agent=${agent}`)
        .then((r) => r.commands ?? [])
        .catch(() => {
          cache.delete(agent);
          return [];
        }),
    );
  return cache.get(agent)!;
};

export function useSlash(agent: AgentId, text: string, setText: (t: string) => void) {
  const [all, setAll] = useState<Command[]>([]);
  const [pick, setPick] = useState(0);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const q = text.match(/^\/([\w:.-]*)$/)?.[1];

  useEffect(() => {
    if (q === undefined) return;
    let live = true;
    void load(agent).then((c) => live && setAll(c));
    return () => {
      live = false;
    };
  }, [agent, q === undefined]);
  useEffect(() => setPick(0), [q]);

  const low = (q ?? "").toLowerCase();
  const list = q === undefined || closedAt === text ? [] : [...all.filter((c) => c.name.toLowerCase().startsWith(low)), ...all.filter((c) => !c.name.toLowerCase().startsWith(low) && c.name.toLowerCase().includes(low))].slice(0, 8);
  const choose = (c: Command) => setText(`/${c.name} `);

  // Returns true when the menu used the key.
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!list.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setPick((p) => (p + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
      return true;
    }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing)) {
      e.preventDefault();
      choose(list[Math.min(pick, list.length - 1)]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setClosedAt(text);
      return true;
    }
    return false;
  };

  const menu = list.length ? (
    <ul role="listbox" aria-label={`${AGENT_NAME[agent]} commands`} className="absolute inset-x-2 bottom-full z-30 mb-2 max-h-[45dvh] overflow-y-auto rounded-[16px] bg-panel-2 p-1.5 shadow-[0_18px_50px_rgb(0_0_0/0.5),inset_0_0_0_1px_rgb(255_255_255/0.08)]">
      {list.map((c, i) => (
        <li key={c.name} role="option" aria-selected={i === pick}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(c)}
            className={cx("flex w-full min-h-11 flex-col items-start rounded-[11px] px-3 py-2 text-left", i === pick ? "bg-white/[0.09]" : "hover:bg-white/[0.05]")}
          >
            <span className="flex items-center gap-2 font-mono text-[13.5px] text-silk">
              /{c.name}
              {c.kind !== "skill" && <span className="font-sans text-[11px] text-silk-3">{c.kind === "builtin" ? "built in" : "command"}</span>}
            </span>
            {c.description && <span className="line-clamp-1 text-[12.5px] text-silk-3">{c.description}</span>}
          </button>
        </li>
      ))}
    </ul>
  ) : null;

  return { menu, onKey };
}
