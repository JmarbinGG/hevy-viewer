"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { clearCachedCredentials, readCachedCredentials } from "./auth-cache";
import { fetchDataStatus, fetchExerciseGraph, fetchExercises, refreshData } from "./api";
import { EXERCISE_GRAPHS, GraphPoint } from "./graphs";
import { DataStatus, ExerciseSummary, HevyCredentials } from "./types";

type GraphPointsById = Record<string, GraphPoint[]>;

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
          setSelectedExercise(data[0].name);
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
      setSelectedExercise(data[0]?.name ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to refresh workout data");
    } finally {
      setRefreshing(false);
    }
  }

  if (hasCredentials === false) {
    return (
      <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
        <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-16">
          <h1 className="text-3xl font-semibold tracking-tight">Exercises</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            You need to sign in before we can fetch your Hevy exercise data.
          </p>
          <Link
            href="/login"
            className="inline-flex w-fit border border-black px-5 py-2 text-sm font-medium transition-colors hover:bg-black hover:text-white dark:border-white dark:hover:bg-white dark:hover:text-black"
          >
            Go to login
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10 md:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-300 pb-6 dark:border-zinc-800">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Hevy Viewer</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Exercises</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="border border-black px-4 py-2 text-sm tracking-wide transition-colors hover:bg-black hover:text-white dark:border-white dark:hover:bg-white dark:hover:text-black"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={logout}
              className="border border-black px-4 py-2 text-sm tracking-wide transition-colors hover:bg-black hover:text-white dark:border-white dark:hover:bg-white dark:hover:text-black"
            >
              Log out
            </button>
          </div>
        </header>

        {error ? (
          <div className="border border-red-500/60 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {dataStatus?.needs_refresh ? (
          <div className="flex flex-wrap items-center justify-between gap-4 border border-amber-500/50 bg-amber-500/5 px-4 py-3 text-sm">
            <p>
              Workout data was last updated {dataStatus.last_updated ?? "never"}. Refresh today&apos;s data?
            </p>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="border border-black px-4 py-2 text-xs font-medium uppercase tracking-wide transition-colors hover:bg-black hover:text-white disabled:cursor-wait disabled:opacity-50 dark:border-white dark:hover:bg-white dark:hover:text-black"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        ) : null}

        <section className="grid gap-8 md:grid-cols-[300px_1fr]">
          <aside className="space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">Exercise list</h2>
            <div className="max-h-[65vh] overflow-y-auto border border-zinc-300 dark:border-zinc-800">
              {loadingExercises ? (
                <p className="px-4 py-3 text-sm text-zinc-500">Loading exercises...</p>
              ) : exercises.length === 0 ? (
                <p className="px-4 py-3 text-sm text-zinc-500">No exercises found.</p>
              ) : (
                <ul>
                  {exercises.map((exercise) => {
                    const isActive = selectedExercise === exercise.name;
                    return (
                      <li key={exercise.id} className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => {
                            if (exercise.name === selectedExercise) {
                              return;
                            }
                            setError(null);
                            setLoadingGraph(true);
                            setSelectedExercise(exercise.name);
                          }}
                          className={`w-full px-4 py-3 text-left transition-colors ${
                            isActive
                              ? "bg-black text-white dark:bg-white dark:text-black"
                              : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                          }`}
                        >
                          <p className="text-sm font-medium">{exercise.name}</p>
                          <p className="mt-1 text-xs opacity-75">
                            {exercise.muscle_groups.join(" • ")} · {exercise.workout_count} workouts
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <section className="space-y-6">
            {!selected ? (
              <div className="border border-zinc-300 px-5 py-4 text-sm text-zinc-500 dark:border-zinc-800">
                Select an exercise to view graphs.
              </div>
            ) : (
              <>
                <div className="border border-zinc-300 p-5 dark:border-zinc-800">
                  <h2 className="text-2xl font-semibold tracking-tight">{selected.name}</h2>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                    {selected.total_volume_kg.toLocaleString()} kg total volume · {selected.set_count} sets
                  </p>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
                  <div>
                    <h3 className="text-lg font-semibold">Progress graph</h3>
                    <p className="mt-1 text-sm text-zinc-500">Choose a metric to compare across sessions.</p>
                  </div>
                  <label className="flex items-center gap-3 text-sm">
                    <span className="text-zinc-500">Metric</span>
                    <select
                      value={selectedGraphId}
                      onChange={(event) => {
                        setLoadingGraph(true);
                        setSelectedGraphId(event.target.value);
                      }}
                      className="border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                    >
                      {EXERCISE_GRAPHS.map((graph) => (
                        <option key={graph.id} value={graph.id}>
                          {graph.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {loadingGraph ? (
                  <div className="border border-zinc-300 px-5 py-4 text-sm text-zinc-500 dark:border-zinc-800">
                    Loading graphs...
                  </div>
                ) : (
                  (() => {
                    const graph = EXERCISE_GRAPHS.find((item) => item.id === selectedGraphId);
                    return graph ? (
                      <article className="border border-zinc-300 p-5 dark:border-zinc-800">
                        <h3 className="text-lg font-semibold">{graph.title}</h3>
                        <p className="mt-1 mb-4 text-sm text-zinc-500">{graph.description}</p>
                        {graph.render({ points: graphs[graph.id] ?? [] })}
                      </article>
                    ) : null;
                  })()
                )}
              </>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}
