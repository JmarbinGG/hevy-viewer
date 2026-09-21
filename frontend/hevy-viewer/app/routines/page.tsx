"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { readCachedCredentials } from "../exercises/auth-cache";
import { fetchAllRoutineAnalytics, fetchRoutines } from "../exercises/api";
import { RoutineAnalytics, RoutineSummary, HevyCredentials, SessionBaselineComparison } from "../exercises/types";
import { applyTheme, readSettings, ViewerSettings } from "../settings";

function formatChartDate(value: number): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

const ROLLING_WINDOW = 4;

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function tone(value: number | null | undefined, invert = false): string {
  if (value === null || value === undefined || Math.abs(value) < 2) return "text-[var(--muted)]";
  return (value > 0) !== invert ? "text-emerald-600" : "text-red-600";
}

function formatStrength(value: number, metric: "1rm" | "reps", unit: "kg" | "lb"): string {
  if (metric === "reps") return `${Math.round(value)} reps`;
  return `${(value * (unit === "lb" ? 2.20462 : 1)).toFixed(1)} ${unit}`;
}

function unavailableReason(baseline: SessionBaselineComparison): string {
  if (baseline.reason === "insufficient_similarity") return `Only ${baseline.muscle_overlap_pct?.toFixed(0)}% muscle overlap — sessions too different to compare.`;
  if (baseline.reason === "no_shared_exercises") return "No shared exercises to compare.";
  return "Not enough earlier sessions yet.";
}

function DeltaCard({ title, subtitle, baseline }: { title: string; subtitle: string; baseline?: SessionBaselineComparison }) {
  return (
    <div className="border border-[var(--border)] p-5">
      <p className="eyebrow">{title}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>
      {baseline?.available ? <>
        <p className={`mt-3 text-4xl font-semibold tracking-tight ${tone(baseline.performance_change_pct)}`}>{pct(baseline.performance_change_pct)}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">{baseline.confidence} confidence · {baseline.muscle_overlap_pct?.toFixed(0)}% muscle overlap</p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-[var(--muted)]">Volume</dt><dd className="text-[var(--muted)]">{pct(baseline.volume_change_pct, 0)}</dd></div>
          <div><dt className="text-xs text-[var(--muted)]">Sets</dt><dd className="text-[var(--muted)]">{pct(baseline.set_change_pct, 0)}</dd></div>
          <div><dt className="text-xs text-[var(--muted)]">Duration</dt><dd className="text-[var(--muted)]">{pct(baseline.duration_change_pct, 0)}</dd></div>
        </dl>
      </> : <p className="mt-4 text-sm text-[var(--muted)]">{baseline ? unavailableReason(baseline) : "—"}</p>}
    </div>
  );
}

export default function RoutinesPage() {
  const [credentials, setCredentials] = useState<HevyCredentials | null>(null);
  const [routines, setRoutines] = useState<RoutineSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<RoutineAnalytics | null>(null);
  const [routineAnalytics, setRoutineAnalytics] = useState<Record<string, RoutineAnalytics>>({});
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
        setSelectedId(sorted[0]?.id ?? null);
        setLoading(false);
        setLoadingAnalytics(Boolean(sorted.length));
        void fetchAllRoutineAnalytics(current).then((loadedAnalytics) => {
          setRoutineAnalytics(loadedAnalytics);
          setAnalytics(sorted[0] ? loadedAnalytics[sorted[0].id] ?? null : null);
        }).catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Routine sessions could not be loaded.");
        }).finally(() => setLoadingAnalytics(false));
      });
    }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load routines"))
      .finally(() => setLoading(false));
  }, []);

  const selected = useMemo(() => routines.find((routine) => routine.id === selectedId) ?? null, [routines, selectedId]);
  const points = useMemo(
    () => analytics?.comparison_points.filter((point) => !settings.startDate || point.time.slice(0, 10) >= settings.startDate) ?? [],
    [analytics, settings.startDate],
  );
  const chartPoints = useMemo(() => {
    const scored = points.filter((point) => point.performance_index && Number.isFinite(new Date(point.time).getTime()));
    return scored.map((point, index) => {
      const window = scored.slice(Math.max(0, index - ROLLING_WINDOW + 1), index + 1);
      return {
        timestamp: new Date(point.time).getTime(),
        index: point.performance_index,
        rolling: window.reduce((sum, item) => sum + (item.performance_index ?? 0), 0) / window.length,
      };
    });
  }, [points]);
  const unit = settings.unitSystem;
  const comparison = analytics?.performance_comparison;
  const headline = comparison?.vs_previous?.available ? comparison.vs_previous : comparison?.vs_rolling;
  const exerciseRows = headline?.exercises ?? [];
  const tableRows = [...points].reverse();

  function selectRoutine(routineId: string): void {
    setError(null);
    setAnalytics(routineAnalytics[routineId] ?? null);
    setSelectedId(routineId);
  }

  if (!credentials) {
    return <div className="app-shell min-h-screen"><main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-3xl font-semibold">Routines</h1><p className="mt-4 text-sm text-[var(--muted)]">Sign in to compare routine performance.</p><Link href="/login" className="control-button mt-8">Go to login</Link></main></div>;
  }

  return (
    <div className="app-shell min-h-screen">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10 md:px-10">
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--border)] pb-6">
          <div><p className="eyebrow">Hevy Viewer</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Routines</h1><p className="mt-2 text-sm text-[var(--muted)]">Compare each session to your last one and your recent average.</p></div>
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
              {loadingAnalytics ? <div className="border border-[var(--border)] p-5 text-sm text-[var(--muted)]">Loading routine metrics...</div> : analytics ? <>
               {comparison ? <>
                 <div className="border border-[var(--border)] p-5">
                   <p className="eyebrow">Latest session · {comparison.current ? new Date(comparison.current.time).toLocaleDateString() : ""}</p>
                   <h3 className="mt-2 text-xl font-semibold">{comparison.message}</h3>
                   <p className="mt-2 text-sm text-[var(--muted)]">Scored on strength per exercise (best-set est. 1RM), so doing fewer sets is not penalised.</p>
                 </div>
                 <div className="grid gap-4 md:grid-cols-2">
                   <DeltaCard title="vs previous session" subtitle="Same routine, last time" baseline={comparison.vs_previous} />
                   <DeltaCard title={`vs last ${ROLLING_WINDOW} average`} subtitle="Smooths out one-off good/bad days" baseline={comparison.vs_rolling} />
                 </div>
                 {exerciseRows.length > 0 ? <div className="border border-[var(--border)] p-5">
                   <h3 className="text-lg font-semibold">Exercise breakdown</h3>
                   <p className="mt-1 text-sm text-[var(--muted)]">{comparison.vs_previous?.available ? "Latest session vs previous session." : `Latest session vs ${ROLLING_WINDOW}-session average.`}</p>
                   <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
                     <thead className="text-xs uppercase tracking-wider text-[var(--muted)]"><tr><th className="pb-3">Exercise</th><th className="pb-3">Before</th><th className="pb-3">Now</th><th className="pb-3">Change</th><th className="pb-3">Sets</th></tr></thead>
                     <tbody>{exerciseRows.map((row) => <tr key={row.name} className="border-t border-[var(--border)]">
                       <td className="py-3 pr-3">{row.name}</td>
                       <td className="py-3 pr-3 text-[var(--muted)]">{formatStrength(row.baseline, row.metric, unit)}</td>
                       <td className="py-3 pr-3">{formatStrength(row.current, row.metric, unit)}</td>
                       <td className={`py-3 pr-3 font-semibold ${tone(row.change_pct)}`}>{pct(row.change_pct)}</td>
                       <td className="py-3 text-[var(--muted)]">{row.baseline_sets} → {row.current_sets}</td>
                     </tr>)}</tbody></table></div>
                   {(headline?.added_exercises?.length || headline?.removed_exercises?.length) ? <p className="mt-4 text-xs text-[var(--muted)]">
                     {headline?.added_exercises?.length ? `New: ${headline.added_exercises.join(", ")}. ` : ""}{headline?.removed_exercises?.length ? `Skipped: ${headline.removed_exercises.join(", ")}.` : ""}
                   </p> : null}
                   <p className="mt-2 text-xs text-[var(--muted)]">Est. 1RM uses the Epley formula on the best working set; bodyweight lifts use best reps.</p>
                 </div> : null}
               </> : null}
               <div className="border border-[var(--border)] p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                     <h3 className="text-lg font-semibold">{selected.title} trend</h3>
                     <p className="mt-1 text-sm text-[var(--muted)]">Strength index per session (100 = first session) with {ROLLING_WINDOW}-session rolling average.</p>
                    </div>
                   <span className="text-xs text-[var(--muted)]">Higher is better</span>
                  </div>
                 {chartPoints.length > 0 ? (
                    <div className="mt-5 h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                       <ComposedChart data={chartPoints} margin={{ top: 20, right: 20, left: 12, bottom: 12 }}>
                          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 2" />
                          <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={formatChartDate} stroke="var(--chart-axis)" minTickGap={24} />
                          <YAxis width={56} stroke="var(--chart-axis)" tickFormatter={(value: number) => Math.round(value).toString()} domain={["auto", "auto"]} />
                          <Tooltip
                            labelFormatter={(value) => formatChartDate(Number(value))}
                            formatter={(value, name) => [Number(value ?? 0).toFixed(1), name === "index" ? "Session" : "Rolling avg"]}
                            contentStyle={{ backgroundColor: "var(--tooltip-surface)", borderColor: "var(--border)", color: "var(--tooltip-text)" }}
                            itemStyle={{ color: "var(--tooltip-text)" }}
                            labelStyle={{ color: "var(--tooltip-text)" }}
                          />
                          <Line type="monotone" dataKey="index" name="index" stroke="var(--chart-axis)" strokeWidth={1.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                          <Line type="monotone" dataKey="rolling" name="rolling" stroke="hsl(150 65% 40%)" strokeWidth={2.5} strokeDasharray="5 3" dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <p className="mt-5 text-sm text-[var(--muted)]">No sessions match the selected start date.</p>}
                </div>
                <div className="border border-[var(--border)] p-5"><h3 className="text-lg font-semibold">Session history</h3><div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wider text-[var(--muted)]"><tr><th className="pb-3">Session</th><th className="pb-3">Index</th><th className="pb-3">vs prev</th><th className="pb-3">Volume</th><th className="pb-3">Sets</th><th className="pb-3">Time</th></tr></thead><tbody>{tableRows.map((point) => <tr key={point.workout_id} className="border-t border-[var(--border)]">
                  <td className="py-3 pr-3">{new Date(point.time).toLocaleDateString()}</td>
                  <td className="py-3 pr-3">{point.performance_index ? point.performance_index.toFixed(0) : "—"}</td>
                  <td className={`py-3 pr-3 font-semibold ${tone(point.change_vs_previous_pct)}`}>{pct(point.change_vs_previous_pct)}</td>
                  <td className="py-3 pr-3 text-[var(--muted)]">{Math.round(point.volume_kg * (unit === "lb" ? 2.20462 : 1)).toLocaleString()} {unit}</td>
                  <td className="py-3 pr-3 text-[var(--muted)]">{point.set_count ?? "—"}</td>
                  <td className="py-3 text-[var(--muted)]">{point.duration_min ? `${Math.round(point.duration_min)}m` : "—"}</td>
                </tr>)}</tbody></table>{points.length === 0 ? <p className="pt-4 text-sm text-[var(--muted)]">No sessions match the selected start date.</p> : null}<p className="pt-4 text-xs text-[var(--muted)]">&ldquo;vs prev&rdquo; shows — when the previous session hit different muscles (under 70% overlap).</p></div></div>
              </> : null}
            </>}
          </section>
        </section>
      </main>
    </div>
  );
}
