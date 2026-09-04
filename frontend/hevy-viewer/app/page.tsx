import Link from "next/link";

export default function Home() {
  return (
    <div className="app-shell flex min-h-screen items-center justify-center">
      <main className="w-full max-w-3xl px-8 py-24">
        <h1 className="text-4xl font-semibold tracking-tight">Hevy Viewer</h1>
        <p className="mt-4 max-w-xl text-zinc-600 dark:text-zinc-300">
          Explore your exercise history and chart volume trends over time.
        </p>
        <div className="mt-10 flex gap-3">
          <Link
            href="/login"
            className="control-button"
          >
            Sign in
          </Link>
          <Link
            href="/exercises"
            className="control-button"
          >
            Exercises
          </Link>
        </div>
      </main>
    </div>
  );
}
