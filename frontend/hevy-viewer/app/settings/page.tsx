"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { applyTheme, readSettings, saveSettings, ViewerSettings } from "../settings";

export default function SettingsPage() {
  const [settings, setSettings] = useState<ViewerSettings>(() => readSettings());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    applyTheme(settings.colorTheme);
  }, [settings.colorTheme]);

  function updateSettings(next: Partial<ViewerSettings>): void {
    const updated = { ...settings, ...next };
    setSettings(updated);
    saveSettings(updated);
    applyTheme(updated.colorTheme);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="app-shell min-h-screen">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10 md:px-10">
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--border)] pb-6">
          <div>
            <p className="eyebrow">Hevy Viewer</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
              Tune how your training history is displayed. Changes are saved in this browser.
            </p>
          </div>
          <Link href="/exercises" className="control-button">
            Back to exercises
          </Link>
        </header>

        <section className="space-y-8">
          <div className="settings-row">
            <div>
              <h2 className="text-base font-semibold">Weight units</h2>
            </div>
            <div className="segmented-control" role="group" aria-label="Weight units">
              {(["kg", "lb"] as const).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => updateSettings({ unitSystem: unit })}
                  className={settings.unitSystem === unit ? "segment-active" : "segment"}
                  aria-pressed={settings.unitSystem === unit}
                >
                  {unit.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <h2 className="text-base font-semibold">Color theme</h2>
            </div>
            <div className="grid w-full max-w-md grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Color theme">
              {[
                ["coffee", "Coffee"],
                ["blue", "Dark blue"],
                ["cream", "Cream white"],
                ["mono", "Black & white"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateSettings({ colorTheme: value as ViewerSettings["colorTheme"] })}
                  className={`theme-choice theme-choice-${value} ${settings.colorTheme === value ? "theme-choice-active" : ""}`}
                  aria-pressed={settings.colorTheme === value}
                >
                  <span className="block text-sm font-semibold">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <h2 className="text-base font-semibold">Graph start date</h2>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={settings.startDate}
                onChange={(event) => updateSettings({ startDate: event.target.value })}
                className="control-input"
                aria-label="Graph start date"
              />
              {settings.startDate ? (
                <button type="button" onClick={() => updateSettings({ startDate: "" })} className="text-xs underline underline-offset-4">
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <p className="text-sm text-[var(--muted)]" role="status" aria-live="polite">{saved ? "Settings saved." : " "}</p>
      </main>
    </div>
  );
}
