export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`;
}

export function tone(value: number | null | undefined): string {
  if (value === null || value === undefined || Math.abs(value) < 2) return "text-[var(--muted)]";
  return value > 0 ? "text-[var(--gain)]" : "text-[var(--loss)]";
}

export function toneVar(value: number | null | undefined): string {
  if (value === null || value === undefined || Math.abs(value) < 2) return "var(--muted)";
  return value > 0 ? "var(--gain)" : "var(--loss)";
}

export function shortDate(time: string | number): string {
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
