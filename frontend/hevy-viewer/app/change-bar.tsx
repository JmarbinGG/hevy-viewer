import { toneVar } from "./format";

const BAR_CAP_PCT = 30;

export function ChangeBar({ value }: { value: number }) {
  const width = (Math.min(Math.abs(value), BAR_CAP_PCT) / BAR_CAP_PCT) * 50;
  return (
    <div className="relative h-2 w-full bg-[color-mix(in_oklch,var(--border)_45%,transparent)]" aria-hidden>
      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--muted)]" />
      <span className="absolute inset-y-0" style={{ width: `${width}%`, background: toneVar(value), ...(value >= 0 ? { left: "50%" } : { right: "50%" }) }} />
    </div>
  );
}
