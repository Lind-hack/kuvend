import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AGENT_NAME, MODE_INFO, type AgentId, type Mode } from "./api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const CAP: Record<AgentId, string> = { claude: "var(--color-claude)", codex: "var(--color-codex)" };

// An LED: off, lit, or blinking while something records.
export function Led({ color = "var(--color-go)", on = true, blink = false, label }: { color?: string; on?: boolean; blink?: boolean; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("inline-block h-2 w-2 shrink-0 rounded-full", on && "led-on", blink && "led-pulse")}
      style={{ color, background: on ? color : "var(--color-panel-3)" }}
    />
  );
}

// The ladder meter: one fixed ramp for every quantity. Lit segments are green, the top fifth amber,
// the last one red, so a full meter always means "a lot".
export function Meter({ value, max, segments = 10, tone, label }: { value: number; max: number; segments?: number; tone?: string; label: string }) {
  const lit = max <= 0 ? 0 : Math.max(value > 0 ? 1 : 0, Math.round((Math.min(value, max) / max) * segments));
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="inline-flex items-end gap-[2px]">
      {Array.from({ length: segments }, (_, i) => {
        const on = i < lit;
        const ramp = i >= segments - 1 ? "var(--color-clip)" : i >= segments * 0.7 ? "var(--color-warn)" : "var(--color-go)";
        return <span key={i} className="block h-[9px] w-[4px] rounded-[1px]" style={{ background: on ? (tone ?? ramp) : "var(--color-panel-3)", opacity: on ? 1 : 0.9 }} />;
      })}
    </span>
  );
}

// The channel chip: the agent's cap and its name.
export function Scribble({ agent, small }: { agent: AgentId; small?: boolean }) {
  return (
    <span className={cx("scribble inline-flex items-center gap-1.5", small ? "h-6 px-2 text-[12px]" : "h-7 px-2.5 text-[13px]")}>
      <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: CAP[agent] }} aria-hidden />
      {AGENT_NAME[agent]}
    </span>
  );
}

// The 3-position switch: Plan, Edit, Full. Full is the only position in clip red.
export function ModeSwitch({ value, onChange, disabled }: { value: Mode; onChange: (m: Mode) => void; disabled?: boolean }) {
  const modes: Mode[] = ["plan", "edit", "full"];
  return (
    <div role="radiogroup" aria-label="What the agent may do" className="inline-flex rounded-[9px] border border-rule bg-desk p-[3px]">
      {modes.map((m) => {
        const on = m === value;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={MODE_INFO[m].hint}
            onClick={() => onChange(m)}
            className={cx(
              "font-label min-h-8 rounded-[6px] px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-out)]",
              on ? (m === "full" ? "bg-clip text-desk shadow-[0_1px_2px_rgb(0_0_0/0.4)]" : "bg-silk text-desk shadow-[0_1px_2px_rgb(0_0_0/0.4)]") : "text-silk-3 hover:text-silk",
            )}
          >
            {MODE_INFO[m].label}
          </button>
        );
      })}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "plain" | "quiet" | "danger"; size?: "sm" | "md"; icon?: ReactNode };

export function Button({ tone = "plain", size = "md", icon, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[8px] font-medium transition-[background-color,color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-45 disabled:active:scale-100",
        size === "sm" ? "min-h-8 px-2.5 text-[13px]" : "min-h-10 px-3.5 text-[14px]",
        tone === "primary" && "bg-silk text-desk hover:bg-white",
        tone === "plain" && "border border-rule-hi bg-panel-2 text-silk hover:border-silk-3",
        tone === "quiet" && "text-silk-2 hover:bg-panel-3 hover:text-silk",
        tone === "danger" && "border border-clip/50 text-clip hover:bg-clip/10",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-rule-hi px-1 font-mono text-[11px] text-silk-3">{children}</kbd>;
}

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const shortPath = (p: string) => p.replace(/^([A-Za-z]:)?[\\/](Users|home)[\\/][^\\/]+/, "~");
