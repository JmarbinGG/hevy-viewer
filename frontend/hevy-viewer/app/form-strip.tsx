"use client";

import { shortDate, pct, toneVar } from "./format";

export type StripItem = { id: string; time: string | number; change: number | null | undefined };

const BAR_CAP_PCT = 30;
const STRIP_SESSIONS = 40;

export function FormStrip({ items, selectedId, onSelect, compact = false }: { items: StripItem[]; selectedId: string | null; onSelect: (id: string) => void; compact?: boolean }) {
  const visible = items.slice(-STRIP_SESSIONS);
  return (
    <div className="overflow-x-auto pb-1" role="listbox" aria-label="Sessions">
      <div className={`flex w-full items-center gap-1 ${compact ? "h-20" : "h-28"}`}>
        {visible.map((item) => {
          const change = item.change;
          const selected = item.id === selectedId;
          const height = change === null || change === undefined ? 0 : Math.max(3, (Math.min(Math.abs(change), BAR_CAP_PCT) / BAR_CAP_PCT) * (compact ? 34 : 48));
          return (
            <button key={item.id} type="button" role="option" aria-selected={selected}
              onClick={() => onSelect(item.id)}
              title={`${shortDate(item.time)} · ${pct(change)}`}
              className={`relative h-full min-w-3.5 flex-1 ${selected ? "bg-[var(--surface)] outline outline-1 outline-[var(--accent)]" : "hover:bg-[var(--surface)]"}`}>
              <span className="absolute left-0 right-0 top-1/2 h-px bg-[var(--border)]" />
              {height === 0
                ? <span className="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--muted)] opacity-60" />
                : <span className="absolute left-1/2 w-2.5 -translate-x-1/2" style={{ background: toneVar(change), height, ...(change! > 0 ? { bottom: "50%" } : { top: "50%" }) }} />}
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
