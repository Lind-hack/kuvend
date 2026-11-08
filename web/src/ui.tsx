import { X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
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
    <div role="radiogroup" aria-label="What the agent may do" className="inline-flex rounded-full bg-black/25 p-[3px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
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
              "font-label min-h-8 rounded-full px-3.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-out)]",
              on ? (m === "full" ? "bg-clip text-desk shadow-[0_1px_2px_rgb(0_0_0/0.4)]" : "bg-white/[0.12] text-silk shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.4)]") : "text-silk-3 hover:text-silk",
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
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-45 disabled:active:scale-100",
        size === "sm" ? "min-h-8 px-3 text-[13px]" : "min-h-10 px-4 text-[14px]",
        tone === "primary" && "bg-[linear-gradient(180deg,#ffffff,#e9e4dc)] text-desk shadow-[0_1px_0_rgb(255_255_255/0.6)_inset,0_6px_18px_-8px_rgb(246_211_168/0.55)] hover:brightness-105",
        tone === "plain" && "bg-white/[0.06] text-silk shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] hover:bg-white/[0.1]",
        tone === "quiet" && "text-silk-2 hover:bg-white/[0.07] hover:text-silk",
        tone === "danger" && "text-clip shadow-[inset_0_0_0_1px_rgb(240_106_85/0.45)] hover:bg-clip/10",
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

// An agent's colour as a small glowing dot.
export function AgentDot({ agent, className }: { agent: AgentId; className?: string }) {
  return <span aria-hidden className={cx("inline-block h-[7px] w-[7px] shrink-0 rounded-full", className)} style={{ background: CAP[agent], boxShadow: `0 0 10px -1px ${CAP[agent]}` }} />;
}

// The Kuvend mark: three peaks, the middle one lit.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cx("h-5 w-5", className)}>
      <path d="M2 19 L8 9 L11 13.5 L14.5 6 L22 19 Z" fill="rgb(255 255 255 / 0.12)" />
      <path d="M2 19 L8 9 L11 13.5 L14.5 6 L22 19" fill="none" stroke="var(--color-silk)" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="14.5" cy="6" r="1.6" fill="var(--color-dawn)" />
    </svg>
  );
}

// A glass sheet over the room: a centred card on a computer, a bottom sheet on a phone. Escape closes it.
export function Sheet({ title, icon, onClose, children, labelledBy = "sheet-title", wide }: { title: ReactNode; icon?: ReactNode; onClose: () => void; children: ReactNode; labelledBy?: string; wide?: boolean }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
      <div className={cx("glass take-in relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[26px] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-[24px] sm:p-7", wide ? "max-w-[560px]" : "max-w-[460px]")}>
        <span className="mx-auto -mt-2 mb-3 block h-1 w-9 rounded-full bg-white/15 sm:hidden" aria-hidden />
        <div className="flex items-start gap-3">
          {icon && (
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/[0.06] text-silk-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]" aria-hidden>
              {icon}
            </span>
          )}
          <h2 id={labelledBy} className="display min-w-0 flex-1 pt-1 text-[30px]">
            {title}
          </h2>
          <button ref={close} type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-silk-2 transition-colors hover:bg-white/[0.08] hover:text-silk">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
