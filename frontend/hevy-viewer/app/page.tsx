import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-black dark:bg-black dark:text-white">
      <main className="w-full max-w-3xl px-8 py-24">
        <h1 className="text-4xl font-semibold tracking-tight">Hevy Viewer</h1>
        <p className="mt-4 max-w-xl text-zinc-600 dark:text-zinc-300">
          Explore your exercise history and chart volume trends over time.
        </p>
        <div className="mt-10 flex gap-3">
          <Link
            href="/login"
            className="inline-flex border border-black px-6 py-3 text-sm font-medium tracking-wide transition-colors hover:bg-black hover:text-white dark:border-white dark:hover:bg-white dark:hover:text-black"
          >
            Sign in
          </Link>
          <Link
            href="/exercises"
            className="inline-flex border border-zinc-400 px-6 py-3 text-sm font-medium tracking-wide transition-colors hover:border-black dark:border-zinc-600 dark:hover:border-white"
          >
            Exercises
          </Link>
        </div>
      </main>
    </div>
  );
}
