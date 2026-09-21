"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { readCachedCredentials } from "../exercises/auth-cache";
import { fetchAllRoutineAnalytics, fetchRoutines } from "../exercises/api";
import { RoutineAnalytics, RoutineSummary, HevyCredentials, RoutineComparisonPoint, SessionBaselineComparison } from "../exercises/types";
import { applyTheme, readSettings, ViewerSettings } from "../settings";

function formatChartDate(value: number): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

const ROLLING_WINDOW = 4;
const BAR_CAP_PCT = 30;
const STRIP_SESSIONS = 40;

type Mode = "previous" | "rolling";

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`;
}

function tone(value: number | null | undefined): string {
  if (value === null || value === undefined || Math.abs(value) < 2) return "text-[var(--muted)]";
  return value > 0 ? "text-[var(--gain)]" : "text-[var(--loss)]";
}

function toneVar(value: number | null | undefined): string {
  if (value === null || value === undefined || Math.abs(value) < 2) return "var(--muted)";
  return value > 0 ? "var(--gain)" : "var(--loss)";
}

function formatStrength(value: number, metric: "1rm" | "reps", unit: "kg" | "lb"): string {
  if (metric === "reps") return `${Math.round(value)} reps`;
  return `${(value * (unit === "lb" ? 2.20462 : 1)).toFixed(1)} ${unit}`;
}

function shortDate(time: string): string {
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function headline(title: string, time: string, baseline: SessionBaselineComparison | undefined, mode: Mode): string {
  const when = shortDate(time);
  const against = mode === "previous" ? "the session before" : `your last ${baseline?.sample_size ?? ROLLING_WINDOW} sessions`;
  if (!baseline?.available) {
    if (baseline?.reason === "insufficient_similarity") return `${title} on ${when} only trains ${baseline.shared_muscles ?? 0} of ${baseline.total_muscles ?? 0} of the same muscle groups as ${against}, so there is nothing fair to compare.`;
    if (baseline?.reason === "no_shared_exercises") return `${title} on ${when} shares no muscle groups with ${against}.`;
    return `${title} on ${when} has no earlier sessions to compare with.`;
  }
  const change = baseline.performance_change_pct ?? 0;
  if (baseline.status === "similar") return `${title} on ${when} matched ${against}.`;
  return `${title} on ${when} was ${Math.abs(change).toFixed(0)}% ${change > 0 ? "stronger" : "weaker"} than ${against}.`;
}

function FormStrip({ points, selectedId, onSelect }: { points: RoutineComparisonPoint[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const visible = points.slice(-STRIP_SESSIONS);
  return (
    <div className="overflow-x-auto pb-1" role="listbox" aria-label="Sessions">
      <div className="flex h-28 min-w-max items-center gap-1">
        {visible.map((point) => {
          const change = point.change_vs_previous_pct;
          const selected = point.workout_id === selectedId;
          const height = change === null || change === undefined ? 0 : Math.max(3, (Math.min(Math.abs(change), BAR_CAP_PCT) / BAR_CAP_PCT) * 48);
          return (
            <button key={point.workout_id} type="button" role="option" aria-selected={selected}
              onClick={() => onSelect(point.workout_id)}
              title={`${shortDate(point.time)} · ${pct(change)}`}
              className={`relative h-full w-3.5 shrink-0 ${selected ? "bg-[var(--surface)] outline outline-1 outline-[var(--accent)]" : "hover:bg-[var(--surface)]"}`}>
              <span className="absolute left-0 right-0 top-1/2 h-px bg-[var(--border)]" />
              {height === 0
                ? <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--muted)] opacity-60" />
                : <span className="absolute left-[3px] right-[3px]" style={{ background: toneVar(change), height, ...(change! > 0 ? { bottom: "50%" } : { top: "50%" }) }} />}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-[var(--muted)]">
        <span>{visible[0] ? shortDate(visible[0].time) : ""}</span>
        <span>{visible.length ? shortDate(visible[visible.length - 1].time) : ""}</span>
      </div>
    </div>
  );
}

function ChangeBar({ value }: { value: number }) {
  const width = (Math.min(Math.abs(value), BAR_CAP_PCT) / BAR_CAP_PCT) * 50;
  return (
    <div className="relative h-2 w-full bg-[color-mix(in_oklch,var(--border)_45%,transparent)]" aria-hidden>
      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--muted)]" />
      <span className="absolute inset-y-0" style={{ width: `${width}%`, background: toneVar(value), ...(value >= 0 ? { left: "50%" } : { right: "50%" }) }} />
    </div>
  );
}

export default function RoutinesPage() {
  const [credentials, setCredentials] = useState<HevyCredentials | null>(null);
  const [routines, setRoutines] = useState<RoutineSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<RoutineAnalytics | null>(null);
  const [routineAnalytics, setRoutineAnalytics] = useState<Record<string, RoutineAnalytics>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("previous");
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
  const unit = settings.unitSystem;
  const factor = unit === "lb" ? 2.20462 : 1;
  const session = points.find((point) => point.workout_id === sessionId) ?? points[points.length - 1] ?? null;
  const baseline = session ? (mode === "previous" ? session.vs_previous : session.vs_rolling) : undefined;
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
  const tableRows = useMemo(() => [...points].reverse(), [points]);

  function selectRoutine(routineId: string): void {
    setError(null);
    setSessionId(null);
    setAnalytics(routineAnalytics[routineId] ?? null);
    setSelectedId(routineId);
  }

  if (!credentials) {
    return <div className="app-shell min-h-screen"><main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-3xl font-semibold">Routines</h1><p className="mt-4 text-sm text-[var(--muted)]">Sign in to compare routine performance.</p><Link href="/login" className="control-button mt-8">Go to login</Link></main></div>;
  }

  return (
    <div className="app-shell min-h-screen">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 py-8 md:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-lg font-semibold tracking-tight">Routines</h1>
          <nav className="flex gap-3"><Link href="/exercises" className="control-button">Exercises</Link><Link href="/settings" className="control-button">Settings</Link></nav>
        </header>
        {error ? <div className="border border-[var(--loss)] px-4 py-3 text-sm text-[var(--loss)]">{error}</div> : null}
        {loading ? <p className="text-sm text-[var(--muted)]">Loading routines...</p> : routines.length === 0 ? <p className="text-sm text-[var(--muted)]">No routines found.</p> : <>
          <div className="-mb-6 flex gap-6 overflow-x-auto border-b border-[var(--border)]" role="tablist">
            {routines.map((routine) => (
              <button key={routine.id} type="button" role="tab" aria-selected={routine.id === selectedId} onClick={() => selectRoutine(routine.id)}
                className={`-mb-px shrink-0 border-b-2 pb-3 text-sm ${routine.id === selectedId ? "border-[var(--accent)] font-semibold" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}>
                {routine.title} <span className="ml-1 text-xs opacity-60">{routine.workout_count}</span>
              </button>
            ))}
          </div>
          {loadingAnalytics ? <p className="text-sm text-[var(--muted)]">Loading routine metrics...</p> : !selected || !session ? <p className="text-sm text-[var(--muted)]">No sessions match the selected start date.</p> : <>
            <section className="grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <h2 className="max-w-[28ch] text-3xl font-semibold leading-tight tracking-tight md:text-4xl">{headline(selected.title, session.time, baseline, mode)}</h2>
                <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 text-sm tabular-nums">
                  <div><dt className="text-[var(--muted)]">Strength</dt><dd className={`text-2xl font-semibold ${tone(baseline?.performance_change_pct)}`}>{baseline?.available ? pct(baseline.performance_change_pct) : "—"}</dd></div>
                  <div><dt className="text-[var(--muted)]">Volume</dt><dd className="text-2xl font-semibold">{Math.round(session.volume_kg * factor).toLocaleString()} <span className="text-sm font-normal text-[var(--muted)]">{unit}</span></dd><dd className="text-[var(--muted)]">{baseline?.available ? pct(baseline.volume_change_pct, 0) : ""}</dd></div>
                  <div><dt className="text-[var(--muted)]">Sets</dt><dd className="text-2xl font-semibold">{session.set_count ?? "—"}</dd><dd className="text-[var(--muted)]">{baseline?.available ? pct(baseline.set_change_pct, 0) : ""}</dd></div>
                  <div><dt className="text-[var(--muted)]">Time</dt><dd className="text-2xl font-semibold">{session.duration_min ? `${Math.round(session.duration_min)}m` : "—"}</dd><dd className="text-[var(--muted)]">{baseline?.available ? pct(baseline.duration_change_pct, 0) : ""}</dd></div>
                </dl>
              </div>
              <div className="segmented-control self-start md:self-end" role="group" aria-label="Compare against">
                <button type="button" className={mode === "previous" ? "segment-active" : "segment"} onClick={() => setMode("previous")}>Previous</button>
                <button type="button" className={mode === "rolling" ? "segment-active" : "segment"} onClick={() => setMode("rolling")}>{ROLLING_WINDOW}-avg</button>
              </div>
            </section>

            <FormStrip points={points} selectedId={session.workout_id} onSelect={setSessionId} />

            {baseline?.available && baseline.muscles?.length ? <section>
              <h3 className="text-lg font-semibold">Muscle groups</h3>
              <ul className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {baseline.muscles.map((row) => (
                  <li key={`${row.muscle}-${row.metric}`} className="grid items-center gap-x-6 gap-y-2 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_4.5rem]">
                    <div className="min-w-0">
                      <p className="text-sm font-medium capitalize">{row.muscle.replace(/_/g, " ")}</p>
                      {row.basis === "same"
                        ? row.lifts?.map((lift) => <p key={lift.name} className="truncate text-xs tabular-nums text-[var(--muted)]">{lift.name} · {formatStrength(lift.baseline, row.metric, unit)} to {formatStrength(lift.current, row.metric, unit)}</p>)
                        : <p className="truncate text-xs text-[var(--muted)]">{row.swap_from?.join(", ")} to {row.swap_to?.join(", ")}{row.baseline && row.current ? ` · best ${formatStrength(row.baseline, row.metric, unit)} to ${formatStrength(row.current, row.metric, unit)}` : ""}</p>}
                    </div>
                    <ChangeBar value={row.change_pct} />
                    <p className={`text-right text-sm font-semibold tabular-nums ${tone(row.change_pct)}`}>{pct(row.change_pct)}</p>
                  </li>
                ))}
              </ul>
              {(baseline.added_muscles?.length || baseline.removed_muscles?.length) ? <p className="mt-3 text-xs text-[var(--muted)]">
                {baseline.added_muscles?.length ? `New: ${baseline.added_muscles.join(", ")}. ` : ""}{baseline.removed_muscles?.length ? `Skipped: ${baseline.removed_muscles.join(", ")}.` : ""}
              </p> : null}
            </section> : null}

            <section>
              <h3 className="text-lg font-semibold">Trend</h3>
              {chartPoints.length > 0 ? (
                <div className="mt-4 h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartPoints} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 2" vertical={false} />
                      <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={formatChartDate} stroke="var(--chart-axis)" minTickGap={24} />
                      <YAxis width={44} stroke="var(--chart-axis)" tickFormatter={(value: number) => Math.round(value).toString()} domain={["auto", "auto"]} />
                      <Tooltip
                        labelFormatter={(value) => formatChartDate(Number(value))}
                        formatter={(value, name) => [Number(value ?? 0).toFixed(1), name === "index" ? "Session" : `${ROLLING_WINDOW}-session average`]}
                        contentStyle={{ backgroundColor: "var(--tooltip-surface)", borderColor: "var(--border)", color: "var(--tooltip-text)" }}
                        itemStyle={{ color: "var(--tooltip-text)" }}
                        labelStyle={{ color: "var(--tooltip-text)" }}
                      />
                      <ReferenceLine x={new Date(session.time).getTime()} stroke="var(--accent)" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="index" name="index" stroke="var(--chart-axis)" strokeWidth={1.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="rolling" name="rolling" stroke="var(--gain)" strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : null}
            </section>

            <section>
              <h3 className="text-lg font-semibold">History</h3>
              <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm tabular-nums">
                <thead className="text-[var(--muted)]"><tr><th className="pb-3 font-normal">Session</th><th className="pb-3 font-normal">Index</th><th className="pb-3 font-normal">Change</th><th className="pb-3 font-normal">Volume</th><th className="pb-3 font-normal">Sets</th><th className="pb-3 font-normal">Time</th></tr></thead>
                <tbody>{tableRows.map((point) => (
                  <tr key={point.workout_id} onClick={() => setSessionId(point.workout_id)} className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface)] ${point.workout_id === session.workout_id ? "bg-[var(--surface)]" : ""}`}>
                    <td className="py-3 pr-3">{new Date(point.time).toLocaleDateString()}</td>
                    <td className="py-3 pr-3">{point.performance_index ? point.performance_index.toFixed(0) : "—"}</td>
                    <td className={`py-3 pr-3 font-semibold ${tone(point.change_vs_previous_pct)}`}>{pct(point.change_vs_previous_pct)}</td>
                    <td className="py-3 pr-3 text-[var(--muted)]">{Math.round(point.volume_kg * factor).toLocaleString()} {unit}</td>
                    <td className="py-3 pr-3 text-[var(--muted)]">{point.set_count ?? "—"}</td>
                    <td className="py-3 text-[var(--muted)]">{point.duration_min ? `${Math.round(point.duration_min)}m` : "—"}</td>
                  </tr>
                ))}</tbody></table></div>
            </section>
          </>}
        </>}
      </main>
    </div>
  );
}
