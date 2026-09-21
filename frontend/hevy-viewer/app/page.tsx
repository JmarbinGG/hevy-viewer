"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { clearCachedCredentials, readCachedCredentials } from "./exercises/auth-cache";
import { fetchAllRoutineAnalytics, fetchDataStatus, fetchExercises, fetchRoutines } from "./exercises/api";
import { DataStatus, ExerciseSummary, MuscleComparisonRow, RoutineAnalytics, RoutineSummary } from "./exercises/types";
import { applyTheme, readSettings, ViewerSettings } from "./settings";
import { pct, shortDate, tone, toneVar } from "./format";
import { ChangeBar } from "./change-bar";

const MINI_SESSIONS = 16;
const TOP_EXERCISES = 8;
const HERO_MUSCLES = 7;

function Tile({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <div className="aspect-square w-full bg-[var(--surface)]" aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="aspect-square w-full bg-white object-contain" />
  );
}

function MiniStrip({ changes }: { changes: (number | null | undefined)[] }) {
  return (
    <div className="flex h-10 w-full items-center gap-1" aria-hidden>
      {changes.map((change, index) => {
        const height = change === null || change === undefined ? 0 : Math.max(2, (Math.min(Math.abs(change), 30) / 30) * 18);
        return (
          <div key={index} className="relative h-full flex-1">
            <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
            {height > 0 ? <span className="absolute inset-x-[2px]" style={{ height, background: toneVar(change), ...(change! > 0 ? { bottom: "50%" } : { top: "50%" }) }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ViewerSettings>(readSettings);
  const [routines, setRoutines] = useState<RoutineSummary[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, RoutineAnalytics>>({});
  const [exercises, setExercises] = useState<ExerciseSummary[]>([]);
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const [routineList, allAnalytics, exerciseList, dataStatus] = await Promise.all([
          fetchRoutines(credentials),
          fetchAllRoutineAnalytics(credentials),
          fetchExercises(credentials),
          fetchDataStatus(),
        ]);
        setRoutines([...routineList].sort((a, b) => b.workout_count - a.workout_count || a.title.localeCompare(b.title)));
        setAnalytics(allAnalytics);
        setExercises(exerciseList);
        setStatus(dataStatus);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Could not load your data.");
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const latest = useMemo(() => {
    let best: { routine: RoutineSummary; time: string; change: number | null; muscles: MuscleComparisonRow[] } | null = null;
    for (const routine of routines) {
      const points = analytics[routine.id]?.comparison_points ?? [];
      const point = points[points.length - 1];
      if (!point) continue;
      if (!best || new Date(point.time).getTime() > new Date(best.time).getTime()) {
        best = { routine, time: point.time, change: point.change_vs_previous_pct ?? null, muscles: point.vs_previous?.muscles ?? [] };
      }
    }
    return best;
  }, [routines, analytics]);

  const thisMonth = useMemo(() => {
    const now = new Date();
    let count = 0;
    for (const routine of routines) {
      for (const point of analytics[routine.id]?.comparison_points ?? []) {
        const date = new Date(point.time);
        if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) count += 1;
      }
    }
    return count;
  }, [routines, analytics]);

  const topExercises = useMemo(
    () => [...exercises].sort((a, b) => b.workout_count - a.workout_count || b.set_count - a.set_count).slice(0, TOP_EXERCISES),
    [exercises],
  );

  function logout(): void {
    clearCachedCredentials();
    router.push("/login");
  }

  if (signedIn === null) return <div className="app-shell min-h-screen" />;

  if (!signedIn) {
    return (
      <div className="app-shell flex min-h-screen items-center">
        <main className="mx-auto w-full max-w-3xl px-6 py-24">
          <h1 className="text-5xl font-semibold leading-tight tracking-tight">Did today&apos;s workout beat the last one?</h1>
          <p className="mt-5 max-w-[46ch] text-lg text-[var(--muted)]">Sign in with your Hevy account to compare each session with the one before, lift by lift.</p>
          <Link href="/login" className="control-button mt-10">Sign in</Link>
        </main>
      </div>
    );
  }

  const headline = loading
    ? ""
    : !latest
      ? "No workouts yet."
      : latest.change === null
        ? `Your last session was ${latest.routine.title} on ${shortDate(latest.time)}.`
        : Math.abs(latest.change) < 2
          ? `${latest.routine.title} on ${shortDate(latest.time)} matched the session before.`
          : `${latest.routine.title} on ${shortDate(latest.time)} was ${Math.abs(latest.change).toFixed(0)}% ${latest.change > 0 ? "stronger" : "weaker"} than the session before.`;

  return (
    <div className="app-shell min-h-screen">
      <main className="mx-auto flex w-full max-w-[100rem] flex-col gap-16 px-6 py-8 md:px-12 xl:px-16">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-lg font-semibold tracking-tight">Hevy Viewer</h1>
          <nav className="flex flex-wrap gap-3">
            <Link href="/routines" className="control-button">Routines</Link>
            <Link href="/exercises" className="control-button">Exercises</Link>
            <Link href="/settings" className="control-button">Settings</Link>
            <button type="button" onClick={logout} className="control-button">Log out</button>
          </nav>
        </header>

        {error ? <div className="border border-[var(--loss)] px-4 py-3 text-sm text-[var(--loss)]">{error}</div> : null}

        <section className="grid gap-x-20 gap-y-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div>
            <h2 className="min-h-[3lh] max-w-[22ch] text-5xl font-semibold leading-[1.1] tracking-tight md:text-6xl">{headline}</h2>
            <ul className="mt-10 max-w-2xl">
              {latest?.muscles.slice(0, HERO_MUSCLES).map((row) => (
                <li key={`${row.muscle}-${row.metric}`} className="grid grid-cols-[7rem_minmax(0,1fr)_4rem] items-center gap-x-5 py-2.5">
                  <span className="truncate text-sm capitalize">{row.muscle.replace(/_/g, " ")}</span>
                  <ChangeBar value={row.change_pct} />
                  <span className={`text-right text-sm font-semibold tabular-nums ${tone(row.change_pct)}`}>{pct(row.change_pct, 0)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-sm tabular-nums text-[var(--muted)]">
              {loading ? "" : `${thisMonth} sessions this month · ${status?.workout_count ?? "—"} workouts logged · updated ${status?.last_updated ? shortDate(status.last_updated) : "—"}`}
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold">Recent form</h3>
            <ul className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {loading ? <li className="py-4 text-sm text-[var(--muted)]">Loading...</li> : routines.length === 0 ? <li className="py-4 text-sm text-[var(--muted)]">No routines found.</li> : routines.map((routine) => {
                const points = analytics[routine.id]?.comparison_points ?? [];
                const last = points[points.length - 1];
                return (
                  <li key={routine.id}>
                    <Link href="/routines" className="block py-4 hover:bg-[var(--surface)]">
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="truncate text-lg font-medium">{routine.title}</p>
                        <p className={`text-lg font-semibold tabular-nums ${tone(last?.change_vs_previous_pct)}`}>{pct(last?.change_vs_previous_pct)}</p>
                      </div>
                      <div className="mt-2"><MiniStrip changes={points.slice(-MINI_SESSIONS).map((point) => point.change_vs_previous_pct)} /></div>
                      <p className="mt-1 text-xs text-[var(--muted)]">{last ? `${shortDate(last.time)} · ` : ""}{routine.workout_count} sessions</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-semibold">Most trained</h3>
            <Link href="/exercises" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">All exercises</Link>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 xl:grid-cols-8">
            {loading ? null : topExercises.map((exercise) => (
              <li key={exercise.id}>
                <Link href="/exercises" className="group block">
                  <Tile url={exercise.image_url} />
                  <p className="mt-2 truncate text-sm font-medium group-hover:text-[var(--accent)]">{exercise.name}</p>
                  <p className="truncate text-xs text-[var(--muted)]">{exercise.muscle_groups.join(", ")} · {exercise.workout_count}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
