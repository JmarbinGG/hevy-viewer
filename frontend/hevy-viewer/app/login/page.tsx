"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { cacheCredentials } from "../exercises/auth-cache";
import { loginWithHevy } from "../exercises/api";

export default function LoginPage() {
  const router = useRouter();
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const credentials = {
        email_or_username: emailOrUsername.trim(),
        password,
      };
      await loginWithHevy(credentials);
      cacheCredentials(credentials);
      router.push("/exercises");
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6 py-16">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Hevy Viewer</p>
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Enter your Hevy email/username and password. Credentials are cached in this browser for easier
            future fetches.
          </p>
        </header>

        {error ? (
          <div className="border border-red-500/60 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4 border border-zinc-300 p-6 dark:border-zinc-800">
          <label className="block space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Email or username</span>
            <input
              type="text"
              value={emailOrUsername}
              onChange={(event) => setEmailOrUsername(event.target.value)}
              required
              className="w-full border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-black dark:border-zinc-700 dark:focus:border-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-black dark:border-zinc-700 dark:focus:border-white"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full border border-black px-4 py-2 text-sm font-medium tracking-wide transition-colors hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-white dark:hover:bg-white dark:hover:text-black"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <Link href="/" className="text-sm underline underline-offset-4">
          Back to home
        </Link>
      </main>
    </div>
  );
}
