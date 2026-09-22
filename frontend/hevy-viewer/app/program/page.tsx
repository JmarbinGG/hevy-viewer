"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readCachedCredentials } from "../exercises/auth-cache";
import { fetchProgram } from "../exercises/api";
import { ExercisePlan, ProgramResponse, RoutinePlan } from "../exercises/types";
import { applyTheme, readSettings, ViewerSettings } from "../settings";
import { ACTION_LABEL, STATUS_LABEL, actionTone, lastText, planAsText, reasonText, statusTone, targetText } from "../program-text";
import { TopBar } from "../top-bar";
import { ErrorNotice } from "../error-notice";

function Thumb({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <div className="size-11 shrink-0 bg-[var(--surface)]" aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="size-11 shrink-0 bg-white object-contain" />
  );
}

function dueText(routine: RoutinePlan): string {
  const days = Math.round(routine.days_since);
  const done = days <= 0 ? "Done today" : `Last done ${days} ${days === 1 ? "day" : "days"} ago`;
  const gap = routine.typical_gap_days;
  const over = routine.overdue_days;
  const rhythm = gap === null ? "" : ` · usually every ${Math.round(gap)} days`;
  const due = over >= 1 ? ` · ${Math.round(over)} days overdue` : over <= -1 ? ` · due in ${Math.round(-over)} days` : " · due now";
  return `${done}${rhythm}${due}`;
}

function PlanRow({ plan, index, unit }: { plan: ExercisePlan; index: number; unit: "kg" | "lb" }) {
  const stalled = plan.status === "stalled";
  return (
    <li className={`grid items-center gap-x-6 gap-y-2 border-l-2 py-4 pl-4 md:grid-cols-[minmax(0,1fr)_9rem_12rem_6.5rem] ${stalled ? "border-[var(--loss)]" : "border-transparent"}`}>
      <div className="flex min-w-0 items-center gap-4">
        <span className="w-4 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">{index + 1}</span>
        <Thumb url={plan.image_url} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{plan.name}</p>
          <p className="text-xs text-[var(--muted)]">{reasonText(plan)}</p>
        </div>
      </div>
      <div className="text-sm tabular-nums md:text-right">
        <p className="text-xs text-[var(--muted)] md:hidden">Last</p>
        <p className="text-[var(--muted)]">{lastText(plan, unit)}</p>
      </div>
      <div className="tabular-nums md:text-right">
        <p className="text-lg font-semibold">{targetText(plan, unit)}</p>
        <p className={`text-xs font-medium ${actionTone(plan.action)}`}>{ACTION_LABEL[plan.action]} · {plan.target.sets} {plan.target.sets === 1 ? "set" : "sets"}</p>
      </div>
      <p className={`text-xs font-semibold md:text-right ${statusTone(plan.status)}`}>{STATUS_LABEL[plan.status]}</p>
    </li>
  );
}

export default function ProgramPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ViewerSettings>(readSettings);
  const [data, setData] = useState<ProgramResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(settings.colorTheme);
    const handleSettingsChange = (event: Event) => setSettings((event as CustomEvent<ViewerSettings>).detail);
    window.addEventListener("hevy-settings-change", handleSettingsChange);
    return () => window.removeEventListener("hevy-settings-change", handleSettingsChange);
  }, [settings.colorTheme]);

  useEffect(() => {
    const session = readCachedCredentials();
    void Promise.resolve().then(async () => {
      setSignedIn(Boolean(session));
      if (!session) return;
      try {
        setData(await fetchProgram(session));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Could not build your program.");
      }
    });
  }, []);

  const unit = settings.unitSystem;
  const routines = useMemo(() => data?.routines ?? [], [data]);
  const next = routines[0];

  const headline = !data ? "" : !next ? "No routines to plan yet." : `Next up: ${next.title}.`;
  // Stalled lifts that aren't part of any routine would otherwise be invisible here.
  const otherStalled = useMemo(() => {
    const planned = new Set(routines.flatMap((routine) => routine.exercises.map((plan) => plan.name)));
    return Object.values(data?.exercises ?? {})
      .filter((plan) => plan.status === "stalled" && !planned.has(plan.name))
      .sort((a, b) => b.since_best - a.since_best);
  }, [data, routines]);
  const stalledLifts = useMemo(
    () => [
      ...routines.flatMap((routine) => routine.exercises.filter((plan) => plan.status === "stalled").map((plan) => `${plan.name} (${routine.title})`)),
      ...otherStalled.map((plan) => plan.name),
    ],
    [routines, otherStalled],
  );

  async function copyPlan(routine: RoutinePlan): Promise<void> {
    try {
      await navigator.clipboard.writeText(planAsText(routine.title, routine.exercises, unit));
      setCopied(routine.routine_id);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  }

  if (signedIn === null) return <div className="app-shell min-h-screen" />;
  if (!signedIn) {
    return (
      <div className="app-shell min-h-screen">
        <main className="mx-auto max-w-xl px-6 py-16">
          <h1 className="text-3xl font-semibold">Program</h1>
          <p className="mt-4 text-sm text-[var(--muted)]">Sign in to see your next-session plan.</p>
          <Link href="/login" className="control-button mt-8">Go to login</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen">
      <main className="mx-auto flex w-full max-w-[100rem] flex-col gap-12 px-6 py-6 md:px-12 xl:px-16">
        <TopBar />
        {error ? <ErrorNotice message={error} /> : null}

        <div className="max-w-6xl">
          <h1 className="min-h-[1lh] text-4xl font-semibold leading-tight tracking-tight md:text-5xl">{headline}</h1>
          <p className="mt-3 min-h-[1lh] text-sm text-[var(--muted)]">{next ? dueText(next) : ""}</p>
          {stalledLifts.length > 0 ? (
            <p className="mt-1 text-sm text-[var(--loss)]">
              {stalledLifts.length} {stalledLifts.length === 1 ? "lift has" : "lifts have"} stalled: {stalledLifts.join(", ")}.
            </p>
          ) : null}

          {!data ? <p className="mt-10 text-sm text-[var(--muted)]">{error ? "" : "Building your plan..."}</p> : null}

          {routines.map((routine, position) => (
            <section key={routine.routine_id} className="mt-14">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-[var(--border)] pb-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">{position === 0 ? `${routine.title} · next` : routine.title}</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {position === 0 ? `${routine.exercises.length} lifts` : `${dueText(routine)} · ${routine.exercises.length} lifts`}
                    {routine.stalled_count > 0 ? <span className="text-[var(--loss)]"> · {routine.stalled_count} stalled</span> : null}
                  </p>
                </div>
                <button type="button" onClick={() => void copyPlan(routine)} className="control-button">
                  {copied === routine.routine_id ? "Copied" : "Copy plan"}
                </button>
              </div>
              <div className="mt-2 hidden grid-cols-[minmax(0,1fr)_9rem_12rem_6.5rem] gap-x-6 pl-4 text-xs text-[var(--muted)] md:grid">
                <span className="pl-[4.5rem]">Lift</span><span className="text-right">Last time</span><span className="text-right">Next session</span><span className="text-right">Status</span>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {routine.exercises.map((plan, index) => <PlanRow key={plan.name} plan={plan} index={index} unit={unit} />)}
              </ul>
            </section>
          ))}

          {otherStalled.length > 0 ? (
            <section className="mt-14">
              <div className="border-b border-[var(--border)] pb-3">
                <h2 className="text-2xl font-semibold tracking-tight">Other lifts</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Not in a routine<span className="text-[var(--loss)]"> · {otherStalled.length} stalled</span>
                </p>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {otherStalled.map((plan, index) => <PlanRow key={plan.name} plan={plan} index={index} unit={unit} />)}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
