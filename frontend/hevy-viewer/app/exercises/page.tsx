"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { clearCachedCredentials, readCachedCredentials } from "./auth-cache";
import { fetchDataStatus, fetchExerciseGraph, fetchExercises, refreshData } from "./api";
import { EXERCISE_GRAPHS, GraphPoint, toTimeSeries } from "./graphs";
import { DataStatus, ExerciseSummary, HevyCredentials } from "./types";
import { applyTheme, readSettings, ViewerSettings } from "../settings";
import { FormStrip } from "../form-strip";
import { pct, shortDate, tone } from "../format";

const METRIC_NAMES: Record<string, string> = {
  volume_over_time: "volume",
  max_over_time: "top set",
  one_rep_max: "estimated 1RM",
};

type GraphPointsById = Record<string, GraphPoint[]>;

function ExerciseImage({ url, className }: { url: string | null; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return <div className={`${className} shrink-0 bg-[var(--surface)]`} aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} shrink-0 bg-white object-contain`} />
  );
}

export default function ExercisesPage() {
  const router = useRouter();
  const credentialsRef = useRef<HevyCredentials | null>(null);
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const [exercises, setExercises] = useState<ExerciseSummary[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [graphs, setGraphs] = useState<GraphPointsById>({});
  const [loadingExercises, setLoadingExercises] = useState(true);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedGraphId, setSelectedGraphId] = useState(EXERCISE_GRAPHS[0]?.id ?? "");
  const [settings, setSettings] = useState<ViewerSettings>(readSettings);
  const [query, setQuery] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(settings.colorTheme);
    const handleSettingsChange = (event: Event) => {
      const next = (event as CustomEvent<ViewerSettings>).detail;
      setSettings(next);
    };
    window.addEventListener("hevy-settings-change", handleSettingsChange);
    return () => window.removeEventListener("hevy-settings-change", handleSettingsChange);
  }, [settings.colorTheme]);

  useEffect(() => {
    let cancelled = false;

    async function loadExercises(): Promise<void> {
      const credentials = readCachedCredentials();
      credentialsRef.current = credentials;
      if (!credentials) {
        if (!cancelled) {
          setHasCredentials(false);
          setLoadingExercises(false);
        }
        return;
      }

      if (!cancelled) {
        setHasCredentials(true);
      }

      try {
        const status = await fetchDataStatus();
        if (!cancelled) {
          setDataStatus(status);
        }
        const data = await fetchExercises(credentials);
        if (cancelled) {
          return;
        }

        setExercises(data);
        if (data.length > 0) {
          setLoadingGraph(true);
          setSelectedExercise([...data].sort((a, b) => b.workout_count - a.workout_count || b.set_count - a.set_count || a.name.localeCompare(b.name))[0].name);
        }
      } catch (err: unknown) {
        if (cancelled) {
          return;
        }

        const message = err instanceof Error ? err.message : "Failed to load exercises";
        setError(message);
        if (message.includes("Invalid Hevy credentials")) {
          clearCachedCredentials();
          credentialsRef.current = null;
          setHasCredentials(false);
        }
      } finally {
        if (!cancelled) {
          setLoadingExercises(false);
        }
      }
    }

    void loadExercises();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedExercise || !credentialsRef.current) {
      return;
    }

    let cancelled = false;
    async function loadGraphs(): Promise<void> {
      const credentials = credentialsRef.current;
      const exerciseName = selectedExercise;
      if (!credentials || !exerciseName) {
        return;
      }

      try {
        const results = await Promise.all(
          [EXERCISE_GRAPHS.find((graph) => graph.id === selectedGraphId)].map(async (graph) => {
            if (!graph) {
              return ["", []] as const;
            }
            const response = await fetchExerciseGraph(credentials, exerciseName, graph.id);
            return [graph.id, response.points] as const;
          }),
        );
        if (cancelled) {
          return;
        }
        setGraphs(Object.fromEntries(results));
      } catch (err: unknown) {
        if (cancelled) {
          return;
        }

        const message = err instanceof Error ? err.message : "Failed to load graph data";
        setError(message);
        if (message.includes("Invalid Hevy credentials")) {
          clearCachedCredentials();
          credentialsRef.current = null;
          setHasCredentials(false);
        }
      } finally {
        if (!cancelled) {
          setLoadingGraph(false);
        }
      }
    }

    void loadGraphs();
    return () => {
      cancelled = true;
    };
  }, [selectedExercise, selectedGraphId]);

  const selected = useMemo(
    () => exercises.find((exercise) => exercise.name === selectedExercise) ?? null,
    [exercises, selectedExercise],
  );
  const sortedExercises = useMemo(
    () => [...exercises].sort((a, b) => b.workout_count - a.workout_count || b.set_count - a.set_count || a.name.localeCompare(b.name)),
    [exercises],
  );

  const visibleExercises = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? sortedExercises.filter((exercise) => exercise.name.toLowerCase().includes(needle) || exercise.muscle_groups.some((group) => group.toLowerCase().includes(needle))) : sortedExercises;
  }, [sortedExercises, query]);
  const graph = EXERCISE_GRAPHS.find((item) => item.id === selectedGraphId);
  const factor = settings.unitSystem === "lb" ? 2.20462 : 1;
  const unit = settings.unitSystem;
  const series = useMemo(() => {
    if (!graph) return [];
    const filtered = (graphs[graph.id] ?? []).filter((point) => !settings.startDate || point.time.slice(0, 10) >= settings.startDate);
    return toTimeSeries(filtered, graph.valueKey);
  }, [graph, graphs, settings.startDate]);
  const stripItems = useMemo(() => series.map((point, index) => ({
    id: point.workout_id,
    time: point.timestamp,
    change: index > 0 && series[index - 1].value > 0 ? (point.value / series[index - 1].value - 1) * 100 : null,
  })), [series]);
  const sessionIndex = Math.max(0, series.findIndex((point) => point.workout_id === sessionId));
  const activeIndex = sessionId && series.some((point) => point.workout_id === sessionId) ? sessionIndex : series.length - 1;
  const session = series[activeIndex] ?? null;
  const change = stripItems[activeIndex]?.change ?? null;
  const best = series.reduce<(typeof series)[number] | null>((top, point) => (!top || point.value > top.value ? point : top), null);
  const metricName = METRIC_NAMES[selectedGraphId] ?? "value";
  const headline = !selected || loadingGraph ? "" : !session
    ? `No ${metricName} recorded yet.`
    : change === null
      ? `${shortDate(session.timestamp)} is the first recorded session.`
      : Math.abs(change) < 2
        ? `${shortDate(session.timestamp)}: ${metricName} held steady on the session before.`
        : `${shortDate(session.timestamp)}: ${metricName} ${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(0)}% on the session before.`;
  const weight = (value: number) => (value * factor).toFixed(1);

  function logout(): void {
    clearCachedCredentials();
    credentialsRef.current = null;
    router.push("/login");
  }

  async function handleRefresh(): Promise<void> {
    const credentials = credentialsRef.current;
    if (!credentials || refreshing) {
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const status = await refreshData(credentials);
      setDataStatus(status);
      const data = await fetchExercises(credentials);
      setExercises(data);
      setSelectedExercise([...data].sort((a, b) => b.workout_count - a.workout_count || b.set_count - a.set_count || a.name.localeCompare(b.name))[0]?.name ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to refresh workout data");
    } finally {
      setRefreshing(false);
    }
  }

  if (hasCredentials === false) {
    return (
      <div className="app-shell min-h-screen">
        <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-16">
          <h1 className="text-3xl font-semibold tracking-tight">Exercises</h1>
          <p className="text-sm text-[var(--muted)]">Sign in to fetch your Hevy exercise data.</p>
          <Link href="/login" className="control-button">Go to login</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen md:h-dvh md:overflow-hidden">
      <main className="mx-auto flex w-full max-w-[100rem] flex-col gap-6 px-6 py-5 md:h-full md:px-12 xl:px-16">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-lg font-semibold tracking-tight">Exercises</h1>
          <nav className="flex flex-wrap gap-3">
            <Link href="/routines" className="control-button">Routines</Link>
            <Link href="/settings" className="control-button">Settings</Link>
            <Link href="/" className="control-button">Home</Link>
            <button type="button" onClick={logout} className="control-button">Log out</button>
          </nav>
        </header>

        {error ? <div className="border border-[var(--loss)] px-4 py-3 text-sm text-[var(--loss)]">{error}</div> : null}

        {dataStatus?.needs_refresh ? (
          <div className="flex flex-wrap items-center justify-between gap-4 border-l-2 border-[var(--accent)] pl-4 text-sm">
            <p>Workout data was last updated {dataStatus.last_updated ?? "never"}. Refresh today&apos;s data?</p>
            <button type="button" onClick={() => void handleRefresh()} disabled={refreshing} className="control-button disabled:cursor-wait disabled:opacity-50">
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        ) : null}

        <div className="grid gap-10 md:min-h-0 md:flex-1 md:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="md:flex md:min-h-0 md:flex-col">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search exercises"
              aria-label="Search exercises"
              className="control-input w-full"
            />
            <div className="mt-3 max-h-[60vh] overflow-y-auto md:max-h-none md:min-h-0 md:flex-1">
              {loadingExercises ? (
                <p className="py-3 text-sm text-[var(--muted)]">Loading exercises...</p>
              ) : visibleExercises.length === 0 ? (
                <p className="py-3 text-sm text-[var(--muted)]">{exercises.length === 0 ? "No exercises found." : "No matches."}</p>
              ) : (
                <ul>
                  {visibleExercises.map((exercise) => {
                    const isActive = selectedExercise === exercise.name;
                    return (
                      <li key={exercise.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (exercise.name === selectedExercise) return;
                            setError(null);
                            setLoadingGraph(true);
                            setSessionId(null);
                            setSelectedExercise(exercise.name);
                          }}
                          className={`flex w-full items-center gap-3 border-l-2 px-3 py-2 text-left ${isActive ? "border-[var(--accent)] bg-[var(--surface)]" : "border-transparent hover:bg-[var(--surface)]"}`}
                        >
                          <ExerciseImage url={exercise.image_url} className="size-10" />
                          <span className="min-w-0">
                            <span className={`block truncate text-sm ${isActive ? "font-semibold" : ""}`}>{exercise.name}</span>
                            <span className="block truncate text-xs text-[var(--muted)]">{exercise.muscle_groups.join(", ")} · {exercise.workout_count}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-col gap-6">
            {!selected ? (
              <p className="text-sm text-[var(--muted)]">{loadingExercises ? "" : "Select an exercise."}</p>
            ) : (
              <>
                <section>
                  <div className="flex min-w-0 items-center gap-5">
                    <ExerciseImage key={selected.id} url={selected.image_url} className="size-20" />
                    <h2 className="line-clamp-2 min-h-[2lh] min-w-0 text-3xl font-semibold leading-tight tracking-tight">{selected.name}</h2>
                  </div>
                  <p className="mt-2 min-h-[2lh] max-w-[52ch] text-lg text-[var(--muted)]">{headline}</p>
                  <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3 text-sm tabular-nums">
                      <div>
                        <dt className="text-[var(--muted)]">{metricName === "estimated 1RM" ? "Est. 1RM" : metricName === "top set" ? "Top set" : "Volume"}</dt>
                        <dd className="text-2xl font-semibold">{session ? weight(session.value) : "—"} <span className="text-sm font-normal text-[var(--muted)]">{unit}</span></dd>
                        <dd className={`h-5 ${tone(change)}`}>{pct(change)}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Best</dt>
                        <dd className="text-2xl font-semibold">{best ? weight(best.value) : "—"} <span className="text-sm font-normal text-[var(--muted)]">{unit}</span></dd>
                        <dd className="h-5 text-[var(--muted)]">{best ? shortDate(best.timestamp) : ""}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Sessions</dt>
                        <dd className="text-2xl font-semibold">{selected.workout_count}</dd>
                        <dd className="h-5 text-[var(--muted)]">{selected.set_count} sets</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Total volume</dt>
                        <dd className="text-2xl font-semibold">{Math.round(selected.total_volume_kg * factor).toLocaleString()} <span className="text-sm font-normal text-[var(--muted)]">{unit}</span></dd>
                        <dd className="h-5" />
                      </div>
                    </dl>
                </section>

                  <div className="segmented-control w-fit" role="group" aria-label="Metric">
                  {EXERCISE_GRAPHS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={item.id === selectedGraphId ? "segment-active" : "segment"}
                      onClick={() => {
                        if (item.id === selectedGraphId) return;
                        setLoadingGraph(true);
                        setSelectedGraphId(item.id);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <FormStrip compact items={stripItems} selectedId={session?.workout_id ?? null} onSelect={setSessionId} />

                <section className="relative min-h-64 flex-1">
                  <div className="absolute inset-0">
                    {loadingGraph ? <p className="text-sm text-[var(--muted)]">Loading...</p> : graph ? graph.render({
                      points: (graphs[graph.id] ?? []).filter((point) => !settings.startDate || point.time.slice(0, 10) >= settings.startDate),
                      unitSystem: unit,
                      highlight: session?.timestamp,
                    }) : null}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
