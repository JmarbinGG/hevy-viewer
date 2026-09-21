"use client";

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-4 border border-[var(--loss)] px-4 py-3 text-sm text-[var(--loss)]">
      <p className="min-w-0 break-words">{message}</p>
      <button type="button" onClick={() => window.location.reload()} className="control-button">Retry</button>
    </div>
  );
}
