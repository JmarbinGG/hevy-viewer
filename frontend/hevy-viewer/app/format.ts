import { PrType } from "./exercises/types";
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

const LB = 2.20462;

export const PR_TYPE_LABEL: Record<PrType, string> = {
  best_1rm: "Estimated 1RM",
  best_weight: "Heaviest set",
  best_volume: "Best set volume",
  best_reps: "Most reps",
};

export function prAmount(type: PrType, value: number, unit: "kg" | "lb"): string {
  if (type === "best_reps") return `${Math.round(value)} reps`;
  return `${(value * (unit === "lb" ? LB : 1)).toFixed(1)} ${unit}`;
}
