"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readCachedCredentials } from "../exercises/auth-cache";
import { fetchRoutineAnalytics, fetchRoutines } from "../exercises/api";
import { RoutineAnalytics, RoutineSummary, HevyCredentials } from "../exercises/types";
import { applyTheme, readSettings, ViewerSettings } from "../settings";

const LB_PER_KG = 2.20462;

function displayWeight(value: number, settings: ViewerSettings): string {
  const converted = value * (settings.unitSystem === "lb" ? LB_PER_KG : 1);
  return `${(Math.round(converted * 10) / 10).toFixed(1)} ${settings.unitSystem}`;
}

export default function RoutinesPage() {
  const [credentials, setCredentials] = useState<HevyCredentials | null>(null);
  const [routines, setRoutines] = useState<RoutineSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<RoutineAnalytics | null>(null);
  const [settings, setSettings] = useState<ViewerSettings>(readSettings);
  const [loading, setLoading] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(settings.colorTheme);
    const handleSettingsChange = (event: Event) => setSettings((event as CustomEvent<ViewerSettings>).detail);
    window.addEventListener("hevy-settings-change", handleSettingsChange);
    return () => window.removeEventListener("hevy-settings-change", handleSettingsChange);
  }, [settings.colorTheme]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const current = readCachedCredentials();
      setCredentials(current);
      if (!current) {
        setLoading(false);
        return;
      }
      return fetchRoutines(current).then((data) => {
        const sorted = [...data].sort((a, b) => b.workout_count - a.workout_count || a.title.localeCompare(b.title));
        setRoutines(sorted);
        setLoadingAnalytics(Boolean(sorted[0]));
        setSelectedId(sorted[0]?.id ?? null);
      });
    }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load routines"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!credentials || !selectedId) return;
    void fetchRoutineAnalytics(credentials, selectedId)
      .then(setAnalytics)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load routine analytics"))
      .finally(() => setLoadingAnalytics(false));
  }, [credentials, selectedId]);

  const selected = useMemo(() => routines.find((routine) => routine.id === selectedId) ?? null, [routines, selectedId]);
  const points = analytics?.comparison_points.filter((point) => !settings.startDate || point.time.slice(0, 10) >= settings.startDate) ?? [];

  function selectRoutine(routineId: string): void {
    setError(null);
    setAnalytics(null);
    setLoadingAnalytics(true);
    setSelectedId(routineId);
  }

  if (!credentials) {
    return <div className="app-shell min-h-screen"><main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-3xl font-semibold">Routines</h1><p className="mt-4 text-sm text-[var(--muted)]">Sign in to compare routine performance.</p><Link href="/login" className="control-button mt-8">Go to login</Link></main></div>;
  }

  return (
    <div className="app-shell min-h-screen">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10 md:px-10">
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--border)] pb-6">
          <div><p className="eyebrow">Hevy Viewer</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Routines</h1><p className="mt-2 text-sm text-[var(--muted)]">Compare volume and estimated strength across repeated sessions.</p></div>
          <div className="flex gap-3"><Link href="/exercises" className="control-button">Exercises</Link><Link href="/settings" className="control-button">Settings</Link></div>
        </header>
        {error ? <div className="border border-red-500/60 px-4 py-3 text-sm text-red-600">{error}</div> : null}
        <section className="grid gap-8 md:grid-cols-[300px_1fr]">
          <aside><h2 className="eyebrow mb-3">Routine list</h2><div className="border border-[var(--border)]">
            {loading ? <p className="px-4 py-3 text-sm text-[var(--muted)]">Loading routines...</p> : routines.length === 0 ? <p className="px-4 py-3 text-sm text-[var(--muted)]">No routines found.</p> : routines.map((routine) => (
              <button key={routine.id} type="button" onClick={() => selectRoutine(routine.id)} className={`w-full border-b border-[var(--border)] px-4 py-3 text-left last:border-b-0 ${routine.id === selectedId ? "exercise-active" : "exercise-option"}`}>
                <span className="block text-sm font-medium">{routine.title}</span><span className="mt-1 block text-xs opacity-75">{routine.workout_count} workouts · {routine.exercise_count} exercises</span>
              </button>
            ))}</div></aside>
          <section className="space-y-6">
            {!selected ? <div className="border border-[var(--border)] p-5 text-sm text-[var(--muted)]">Select a routine to view comparisons.</div> : <><div className="border border-[var(--border)] p-5"><h2 className="text-2xl font-semibold">{selected.title}</h2><p className="mt-2 text-sm text-[var(--muted)]">{selected.workout_count} sessions · {selected.exercise_count} exercises</p></div>
              {loadingAnalytics ? <div className="border border-[var(--border)] p-5 text-sm text-[var(--muted)]">Loading routine metrics...</div> : analytics ? <><div className="grid gap-4 sm:grid-cols-2"><div className="border border-[var(--border)] p-5"><p className="eyebrow">Total volume</p><p className="mt-2 text-2xl font-semibold">{displayWeight(analytics.total_volume_kg, settings)}</p></div><div className="border border-[var(--border)] p-5"><p className="eyebrow">Estimated 1RM total</p><p className="mt-2 text-2xl font-semibold">{displayWeight(analytics.total_estimated_1rm_kg, settings)}</p></div></div>
                <div className="border border-[var(--border)] p-5"><h3 className="text-lg font-semibold">Session comparison</h3><div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wider text-[var(--muted)]"><tr><th className="pb-3">Session</th><th className="pb-3">Volume</th><th className="pb-3">Estimated 1RM</th></tr></thead><tbody>{points.map((point) => <tr key={point.workout_id} className="border-t border-[var(--border)]"><td className="py-3">{new Date(point.time).toLocaleDateString()}</td><td className="py-3">{displayWeight(point.volume_kg, settings)}</td><td className="py-3">{displayWeight(point.estimated_1rm_kg, settings)}</td></tr>)}</tbody></table>{points.length === 0 ? <p className="pt-4 text-sm text-[var(--muted)]">No sessions match the selected start date.</p> : null}</div></div>
              </> : null}
            </>}
          </section>
        </section>
      </main>
    </div>
  );
}
