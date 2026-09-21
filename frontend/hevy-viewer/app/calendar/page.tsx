"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readCachedCredentials } from "../exercises/auth-cache";
import { fetchAllRoutineAnalytics, fetchPrs, fetchRoutines, fetchWorkouts } from "../exercises/api";
import { PersonalRecord, PrType, RoutineAnalytics, RoutineComparisonPoint, RoutineSummary, WorkoutSummary } from "../exercises/types";
import { applyTheme, readSettings, ViewerSettings } from "../settings";
import { pct, shortDate, tone, toneVar } from "../format";
import { ChangeBar } from "../change-bar";
import { TopBar } from "../top-bar";
import { ErrorNotice } from "../error-notice";

const WEEKS_PER_ROW = 2;
const ROW_DAYS = WEEKS_PER_ROW * 7;
const ROW_COLUMNS = { gridTemplateColumns: `3.5rem repeat(${ROW_DAYS}, minmax(0, 1fr))` };
const WEEKDAY_LETTERS = Array.from({ length: ROW_DAYS }, (_, index) => "SMTWTFS"[index % 7]);

const PR_LABEL: Record<PrType, string> = {
  best_1rm: "1RM",
  best_weight: "Heaviest set",
  best_volume: "Set volume",
  best_reps: "Reps",
};

type Session = { key: string; title: string; routine: RoutineSummary | null; point: RoutineComparisonPoint };

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sentence(session: Session): string {
  const change = session.point.change_vs_previous_pct;
  const name = session.title;
  if (!session.routine) return `${name} is not part of a routine, so there is nothing to compare it with.`;
  if (change === null || change === undefined) return `${name}: no fair comparison with the session before.`;
  if (Math.abs(change) < 2) return `${name} matched the session before.`;
  return `${name} was ${Math.abs(change).toFixed(0)}% ${change > 0 ? "stronger" : "weaker"} than the session before.`;
}

function DayDot({ date, sessions, prCount, selected, isToday, todayKey, onSelect }: { date: Date; sessions: Session[]; prCount: number; selected: boolean; isToday: boolean; todayKey: string; onSelect: (key: string) => void }) {
  const key = dayKey(date);
  const ring = isToday ? "outline outline-1 outline-offset-1 outline-[var(--accent)]" : "";
  const title = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (sessions.length === 0) {
    const future = key > todayKey;
    return <span title={title} className={`aspect-square rounded-[3px] ${future ? "border border-[color-mix(in_oklch,var(--border)_60%,transparent)] opacity-60" : "bg-[color-mix(in_oklch,var(--border)_28%,transparent)]"} ${ring}`} />;
  }
  const change = sessions[0].point.change_vs_previous_pct;
  return (
    <button
      type="button"
      onClick={() => onSelect(key)}
      aria-pressed={selected}
      aria-label={`${title}: ${sessions.map((session) => session.title).join(", ")}`}
      title={`${title} · ${sessions.map((session) => (session.routine ? `${session.title} ${pct(session.point.change_vs_previous_pct, 0)}` : session.title)).join(", ")}${prCount ? ` · ${prCount} ${prCount === 1 ? "record" : "records"}` : ""}`}
      className={`relative aspect-square rounded-[3px] ${ring} ${selected ? "outline outline-2 outline-offset-1 outline-[var(--foreground)]" : "hover:outline hover:outline-1 hover:outline-offset-1 hover:outline-[var(--muted)]"}`}
      style={{ background: `color-mix(in oklab, ${sessions[0].routine ? toneVar(change) : "var(--muted)"} 78%, var(--background))` }}
    >
      {prCount > 0 ? <span className="absolute right-[3px] top-[3px] size-[5px] rounded-full bg-[var(--foreground)]" aria-hidden /> : null}
    </button>
  );
}

export default function CalendarPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ViewerSettings>(readSettings);
  const [routines, setRoutines] = useState<RoutineSummary[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, RoutineAnalytics>>({});
  const [workouts, setWorkouts] = useState<WorkoutSummary[]>([]);
  const [prs, setPrs] = useState<PersonalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(settings.colorTheme);
    const handleSettingsChange = (event: Event) => setSettings((event as CustomEvent<ViewerSettings>).detail);
    window.addEventListener("hevy-settings-change", handleSettingsChange);
    return () => window.removeEventListener("hevy-settings-change", handleSettingsChange);
  }, [settings.colorTheme]);

  useEffect(() => {
    const credentials = readCachedCredentials();
    void Promise.resolve().then(async () => {
      setSignedIn(Boolean(credentials));
      if (!credentials) {
        setLoading(false);
        return;
      }
      try {
        const [routineList, allAnalytics, workoutList, prData] = await Promise.all([fetchRoutines(credentials), fetchAllRoutineAnalytics(credentials), fetchWorkouts(credentials), fetchPrs(credentials)]);
        setRoutines(routineList);
        setAnalytics(allAnalytics);
        setWorkouts(workoutList);
        setPrs(prData.prs.filter((pr) => !pr.is_first));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Could not load your workouts.");
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const byDay = useMemo(() => {
    const analyzed = new Map<string, { routine: RoutineSummary; point: RoutineComparisonPoint }>();
    for (const routine of routines) {
      for (const point of analytics[routine.id]?.comparison_points ?? []) analyzed.set(point.workout_id, { routine, point });
    }
    const map = new Map<string, Session[]>();
    for (const workout of workouts) {
      const date = new Date(workout.time);
      if (!Number.isFinite(date.getTime())) continue;
      const key = dayKey(date);
      const match = analyzed.get(workout.workout_id);
      const session: Session = match
        ? { key, title: match.routine.title, routine: match.routine, point: match.point }
        : {
            key,
            title: workout.name,
            routine: null,
            point: { workout_id: workout.workout_id, time: workout.time, volume_kg: workout.volume_kg, estimated_1rm_kg: 0, set_count: workout.set_count, duration_min: workout.duration_min },
          };
      map.set(key, [...(map.get(key) ?? []), session]);
    }
    return map;
  }, [routines, analytics, workouts]);

  const weeks = useMemo(() => {
    const today = new Date();
    const firstKey = [...byDay.keys()].sort()[0];
    const first = firstKey ? new Date(Number(firstKey.slice(0, 4)), Number(firstKey.slice(5, 7)) - 1, Number(firstKey.slice(8, 10))) : today;
    const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - first.getDay());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (6 - today.getDay()));
    const rows: { start: Date; days: Date[]; label: string | null; year: number | null }[] = [];
    for (let cursor = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (ROW_DAYS - 1)); cursor >= start; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - ROW_DAYS)) {
      const days = Array.from({ length: ROW_DAYS }, (_, index) => new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + index));
      const firstOfMonth = days.find((day) => day.getDate() === 1);
      const label = firstOfMonth ?? (rows.length === 0 ? days[ROW_DAYS - 1] : null);
      rows.push({
        start: cursor,
        days,
        label: label ? label.toLocaleDateString(undefined, { month: "short" }) : null,
        year: label && (label.getMonth() === 0 || rows.length === 0) ? label.getFullYear() : null,
      });
    }
    return rows;
  }, [byDay]);

  const prsByWorkout = useMemo(() => {
    const map = new Map<string, PersonalRecord[]>();
    for (const pr of prs) map.set(pr.workout_id, [...(map.get(pr.workout_id) ?? []), pr]);
    return map;
  }, [prs]);

  const latestKey = useMemo(() => [...byDay.keys()].sort().pop() ?? null, [byDay]);
  const todayKey = dayKey(new Date());
  const activeKey = selectedKey ?? latestKey;
  const selectedSessions = activeKey ? byDay.get(activeKey) ?? [] : [];
  const factor = settings.unitSystem === "lb" ? 2.20462 : 1;

  if (signedIn === null) return <div className="app-shell min-h-screen" />;

  if (!signedIn) {
    return (
      <div className="app-shell min-h-screen">
        <main className="mx-auto max-w-xl px-6 py-16">
          <h1 className="text-3xl font-semibold">Calendar</h1>
          <p className="mt-4 text-sm text-[var(--muted)]">Sign in to see your workouts by day.</p>
          <Link href="/login" className="control-button mt-8">Go to login</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen">
      <main className="mx-auto flex w-full max-w-[100rem] flex-col gap-8 px-6 py-6 md:px-12 xl:px-16">
        <TopBar />

        {error ? <ErrorNotice message={error} /> : null}

        <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="min-w-0">
            {loading ? <p className="text-sm text-[var(--muted)]">Loading...</p> : (
              <div className="max-w-2xl">
                <div className="sticky top-0 z-10 grid gap-1.5 bg-[var(--background)] pt-1 text-center text-xs text-[var(--muted)]" style={ROW_COLUMNS}>
                  <span />
                  {WEEKDAY_LETTERS.map((day, index) => <span key={index}>{day}</span>)}
                </div>
                <div className="flex flex-col gap-1.5 pt-3">
                  {weeks.map((week) => (
                    <div key={dayKey(week.start)} className="grid items-center gap-1.5" style={ROW_COLUMNS}>
                      <div className="pr-2 text-right text-xs leading-tight">
                        {week.label ? <span className="font-semibold">{week.label}</span> : null}
                        {week.year ? <span className="block text-[var(--muted)]">{week.year}</span> : null}
                      </div>
                      {week.days.map((date) => {
                        const key = dayKey(date);
                        return <DayDot key={key} date={date} sessions={byDay.get(key) ?? []} prCount={(byDay.get(key) ?? []).reduce((sum, session) => sum + (prsByWorkout.get(session.point.workout_id)?.length ?? 0), 0)} selected={key === activeKey} isToday={key === todayKey} todayKey={todayKey} onSelect={setSelectedKey} />;
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start">
            {loading ? <p className="text-sm text-[var(--muted)]">Loading...</p> : selectedSessions.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{latestKey ? "Pick a day with a workout." : "No workouts yet."}</p>
            ) : selectedSessions.map((session) => {
              const baseline = session.point.vs_previous;
              return (
                <article key={session.point.workout_id} className="mb-10 last:mb-0">
                  <p className="text-sm text-[var(--muted)]">{new Date(session.point.time).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
                  <h3 className="mt-1 text-2xl font-semibold leading-tight tracking-tight">{sentence(session)}</h3>
                  <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-sm tabular-nums">
                    <div>
                      <dt className="text-[var(--muted)]">Volume</dt>
                      <dd className="text-xl font-semibold">{Math.round(session.point.volume_kg * factor).toLocaleString()} <span className="text-sm font-normal text-[var(--muted)]">{settings.unitSystem}</span></dd>
                      <dd className="h-5 text-[var(--muted)]">{baseline?.available ? pct(baseline.volume_change_pct, 0) : ""}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Sets</dt>
                      <dd className="text-xl font-semibold">{session.point.set_count ?? "—"}</dd>
                      <dd className="h-5 text-[var(--muted)]">{baseline?.available ? pct(baseline.set_change_pct, 0) : ""}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--muted)]">Time</dt>
                      <dd className="text-xl font-semibold">{session.point.duration_min ? `${Math.round(session.point.duration_min)}m` : "—"}</dd>
                      <dd className="h-5 text-[var(--muted)]">{baseline?.available ? pct(baseline.duration_change_pct, 0) : ""}</dd>
                    </div>
                  </dl>
                  {baseline?.available && baseline.muscles?.length ? (
                    <ul className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                      {baseline.muscles.map((row) => (
                        <li key={`${row.muscle}-${row.metric}`} className="grid grid-cols-[6rem_minmax(0,1fr)_3.5rem] items-center gap-x-4 py-2.5">
                          <span className="truncate text-sm capitalize">{row.muscle.replace(/_/g, " ")}</span>
                          <ChangeBar value={row.change_pct} />
                          <span className={`text-right text-sm font-semibold tabular-nums ${tone(row.change_pct)}`}>{pct(row.change_pct, 0)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {(prsByWorkout.get(session.point.workout_id) ?? []).length > 0 ? (
                    <div className="mt-6">
                      <h4 className="text-sm font-semibold">Records</h4>
                      <ul className="mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                        {(prsByWorkout.get(session.point.workout_id) ?? []).map((pr) => (
                          <li key={`${pr.exercise}-${pr.type}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                            <span className="min-w-0 truncate">{pr.exercise} <span className="text-[var(--muted)]">{PR_LABEL[pr.type]}</span></span>
                            <span className={`shrink-0 font-semibold tabular-nums ${tone(pr.change_pct)}`}>{pct(pr.change_pct, 0)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {session.routine ? <Link href="/routines" className="mt-4 inline-block text-sm text-[var(--muted)] hover:text-[var(--accent)]">Open {session.title} · {shortDate(session.point.time)}</Link> : null}
                </article>
              );
            })}
          </aside>
        </div>
      </main>
    </div>
  );
}
