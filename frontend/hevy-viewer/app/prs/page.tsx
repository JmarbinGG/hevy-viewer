"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readCachedCredentials } from "../exercises/auth-cache";
import { fetchPrs } from "../exercises/api";
import { ExerciseRecord, PersonalRecord, PrResponse, PrType } from "../exercises/types";
import { applyTheme, readSettings, ViewerSettings } from "../settings";
import { pct, shortDate, tone } from "../format";
import { TopBar } from "../top-bar";
import { ErrorNotice } from "../error-notice";

const PAGE_SIZE = 40;
const RECENT_DAYS = 30;
const LB = 2.20462;

const TYPE_LABEL: Record<PrType, string> = {
  best_1rm: "Estimated 1RM",
  best_weight: "Heaviest set",
  best_volume: "Best set volume",
  best_reps: "Most reps",
};

const FILTERS: { id: PrType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "best_1rm", label: "1RM" },
  { id: "best_weight", label: "Weight" },
  { id: "best_volume", label: "Volume" },
  { id: "best_reps", label: "Reps" },
];

function Thumb({ url, className }: { url: string | null; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <div className={`${className} shrink-0 bg-[var(--surface)]`} aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} shrink-0 bg-white object-contain`} />
  );
}

function amount(type: PrType, value: number, unit: "kg" | "lb"): string {
  if (type === "best_reps") return `${Math.round(value)} reps`;
  return `${(value * (unit === "lb" ? LB : 1)).toFixed(1)} ${unit}`;
}

function setDetail(pr: PersonalRecord, unit: "kg" | "lb"): string {
  const weight = `${(pr.weight_kg * (unit === "lb" ? LB : 1)).toFixed(1)} ${unit}`;
  if (pr.type === "best_reps") return pr.weight_kg > 0 ? `at ${weight}` : "bodyweight";
  if (pr.type === "best_weight") return `× ${pr.reps} reps`;
  return `${weight} × ${pr.reps}`;
}

function dayKey(time: string): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function PrsPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ViewerSettings>(readSettings);
  const [data, setData] = useState<PrResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PrType | "all">("all");
  const [showFirsts, setShowFirsts] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [now] = useState(() => Date.now());

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
        setData(await fetchPrs(session));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Could not load your records.");
      }
    });
  }, []);

  const unit = settings.unitSystem;
  const improvements = useMemo(() => (data?.prs ?? []).filter((pr) => !pr.is_first), [data]);
  const recent = useMemo(() => {
    const cutoff = now - RECENT_DAYS * 24 * 60 * 60 * 1000;
    return improvements.filter((pr) => new Date(pr.time).getTime() >= cutoff);
  }, [improvements, now]);

  const feed = useMemo(
    () => (data?.prs ?? [])
      .filter((pr) => (showFirsts || !pr.is_first) && (filter === "all" || pr.type === filter))
      .filter((pr) => !settings.startDate || pr.time.slice(0, 10) >= settings.startDate),
    [data, filter, showFirsts, settings.startDate],
  );
  const shown = feed.slice(0, visible);
  const groups = useMemo(() => {
    const map = new Map<string, PersonalRecord[]>();
    for (const pr of shown) map.set(dayKey(pr.time), [...(map.get(dayKey(pr.time)) ?? []), pr]);
    return [...map.values()];
  }, [shown]);

  const latest = improvements[0];
  const headline = !data
    ? ""
    : recent.length > 0
      ? `${recent.length} new ${recent.length === 1 ? "record" : "records"} in the last ${RECENT_DAYS} days.`
      : "No new records in the last 30 days.";
  const exerciseCount = new Set(improvements.map((pr) => pr.exercise)).size;

  if (signedIn === null) return <div className="app-shell min-h-screen" />;
  if (!signedIn) {
    return (
      <div className="app-shell min-h-screen">
        <main className="mx-auto max-w-xl px-6 py-16">
          <h1 className="text-3xl font-semibold">Records</h1>
          <p className="mt-4 text-sm text-[var(--muted)]">Sign in to see your personal records.</p>
          <Link href="/login" className="control-button mt-8">Go to login</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen">
      <main className="mx-auto flex w-full max-w-[100rem] flex-col gap-10 px-6 py-6 md:px-12 xl:px-16">
        <TopBar />
        {error ? <ErrorNotice message={error} /> : null}

        <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <section className="min-w-0">
            <h1 className="min-h-[2lh] max-w-[26ch] text-4xl font-semibold leading-tight tracking-tight md:text-5xl">{headline}</h1>
            <p className="mt-3 min-h-[1lh] text-sm tabular-nums text-[var(--muted)]">
              {data ? `${improvements.length} records across ${exerciseCount} exercises${latest ? ` · latest ${shortDate(latest.time)}` : ""}` : ""}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <div className="segmented-control" role="group" aria-label="Record type">
                {FILTERS.map((item) => (
                  <button key={item.id} type="button" className={item.id === filter ? "segment-active" : "segment"} onClick={() => { setFilter(item.id); setVisible(PAGE_SIZE); }}>{item.label}</button>
                ))}
              </div>
              <button type="button" aria-pressed={showFirsts} onClick={() => { setShowFirsts((value) => !value); setVisible(PAGE_SIZE); }} className="control-button">
                {showFirsts ? "Hide first records" : "Show first records"}
              </button>
            </div>

            <div className="mt-8">
              {!data ? <p className="text-sm text-[var(--muted)]">{error ? "" : "Loading..."}</p> : groups.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No records match this filter.</p>
              ) : groups.map((group) => (
                <div key={dayKey(group[0].time)} className="mb-8 last:mb-0">
                  <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] pb-2">
                    <h2 className="text-sm font-semibold">{new Date(group[0].time).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h2>
                    <span className="text-xs text-[var(--muted)]">{group[0].workout_name}</span>
                  </div>
                  <ul className="divide-y divide-[var(--border)]">
                    {group.map((pr) => (
                      <li key={`${pr.workout_id}-${pr.exercise}-${pr.type}`} className="flex items-center gap-4 py-3">
                        <Thumb url={pr.image_url} className="size-11" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{pr.exercise}</p>
                          <p className="truncate text-xs text-[var(--muted)]">{TYPE_LABEL[pr.type]} · {setDetail(pr, unit)}</p>
                        </div>
                        <div className="shrink-0 text-right tabular-nums">
                          <p className="text-lg font-semibold">{amount(pr.type, pr.value, unit)}</p>
                          <p className={`text-xs ${pr.is_first ? "text-[var(--muted)]" : tone(pr.change_pct)}`}>
                            {pr.is_first || pr.previous_value === null ? "First record" : `${pct(pr.change_pct)} from ${amount(pr.type, pr.previous_value, unit)}`}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {feed.length > visible ? <button type="button" onClick={() => setVisible((value) => value + PAGE_SIZE)} className="control-button mt-2">Show more ({feed.length - visible} left)</button> : null}
            </div>
          </section>

          <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
            <h2 className="text-lg font-semibold">Current bests</h2>
            <ul className="mt-4 max-h-[70vh] divide-y divide-[var(--border)] overflow-y-auto border-y border-[var(--border)]">
              {(data?.records ?? []).map((record: ExerciseRecord) => (
                <li key={record.exercise} className="flex items-center gap-3 py-3">
                  <Thumb url={record.image_url} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{record.exercise}</p>
                    <p className="text-xs text-[var(--muted)]">Last record {shortDate(record.last_pr_time)}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">
                    {record.bests.best_1rm ? <p className="font-semibold">{amount("best_1rm", record.bests.best_1rm.value, unit)}</p> : record.bests.best_weight ? <p className="font-semibold">{amount("best_weight", record.bests.best_weight.value, unit)}</p> : record.bests.best_reps ? <p className="font-semibold">{amount("best_reps", record.bests.best_reps.value, unit)}</p> : null}
                    <p className="text-xs text-[var(--muted)]">{record.bests.best_1rm ? "est. 1RM" : record.bests.best_weight ? "heaviest" : "most reps"}</p>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </main>
    </div>
  );
}
