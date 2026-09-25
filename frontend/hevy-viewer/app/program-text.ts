import { ExercisePlan, PlanAction, PlanStatus } from "./exercises/types";

export type Unit = "kg" | "lb";

const LB = 2.20462;

export const ACTION_LABEL: Record<PlanAction, string> = {
  add_weight: "Add weight",
  add_reps: "Add a rep",
  deload: "Deload",
  repeat: "Repeat",
};

export const STATUS_LABEL: Record<PlanStatus, string> = {
  progressing: "Progressing",
  steady: "Steady",
  stalled: "Stalled",
  new: "New",
};

export function weightText(kg: number, unit: Unit): string {
  return `${(kg * (unit === "lb" ? LB : 1)).toFixed(1)} ${unit}`;
}

/** "140.0 lb × 6" for weighted lifts, "12 reps" for bodyweight ones. */
export function setText(weightKg: number, reps: number, unit: Unit): string {
  return weightKg > 0 ? `${weightText(weightKg, unit)} × ${reps}` : `${reps} reps`;
}

export function lastText(plan: ExercisePlan, unit: Unit): string {
  return setText(plan.last_top.weight_kg, plan.last_top.reps, unit);
}

export function targetText(plan: ExercisePlan, unit: Unit): string {
  return setText(plan.target.weight_kg, plan.target.reps, unit);
}

export function reasonText(plan: ExercisePlan): string {
  const [low, high] = plan.target.rep_range;
  switch (plan.reason.code) {
    case "hit_ceiling":
      return `Hit ${plan.last_top.reps} reps at the top of the ${low}–${high} range, so add weight.`;
    case "build_reps":
      return plan.metric === "reps"
        ? `Add a rep to your best set of ${plan.last_top.reps}.`
        : `Working in ${low}–${high} reps. Add a rep before adding weight.`;
    case "stalled":
      return plan.action === "deload"
        ? `No new best in ${plan.since_best} sessions. Drop ${plan.reason.deload_pct}% and rebuild.`
        : `No new best in ${plan.since_best} sessions. Try a new rep target or a variation.`;
    default:
      return `${plan.sessions} ${plan.sessions === 1 ? "session" : "sessions"} logged. Repeat it to set a baseline.`;
  }
}

export function statusTone(status: PlanStatus): string {
  if (status === "stalled") return "text-[var(--loss)]";
  if (status === "progressing") return "text-[var(--gain)]";
  return "text-[var(--muted)]";
}

export function actionTone(action: PlanAction): string {
  if (action === "deload") return "text-[var(--loss)]";
  if (action === "repeat") return "text-[var(--muted)]";
  return "text-[var(--gain)]";
}

export function planAsText(title: string, plans: ExercisePlan[], unit: Unit): string {
  const lines = plans.map((plan, index) => {
    const load = plan.target.weight_kg > 0 ? ` @ ${weightText(plan.target.weight_kg, unit)}` : "";
    return `${index + 1}. ${plan.name} — ${plan.target.sets} × ${plan.target.reps} reps${load} (${ACTION_LABEL[plan.action].toLowerCase()})`;
  });
  return [`${title} — next session`, ...lines].join("\n");
}

export const REVIEW_VERDICT_LABEL: Record<import("./exercises/types").ReviewVerdict, string> = {
  ahead: "Ahead of plan",
  on_plan: "On plan",
  behind: "Behind plan",
  new: "New territory",
};

export function reviewTone(verdict: import("./exercises/types").ReviewVerdict): string {
  if (verdict === "ahead") return "text-[var(--gain)]";
  if (verdict === "behind") return "text-[var(--loss)]";
  return "text-[var(--muted)]";
}

/** One line estimating how a workout went against the plan it followed into that session. */
export function reviewSummary(review: import("./exercises/types").WorkoutReview | null): string {
  if (!review) return "";
  if (review.compared === 0) return "First time logging these lifts, so there's no plan yet to compare against.";
  const hit = review.exceeded + review.met;
  const detail = review.exceeded > 0 ? `, ${review.exceeded} of them by more than planned` : "";
  return `Matched or beat the plan on ${hit} of ${review.compared} lifts${detail}.`;
}
