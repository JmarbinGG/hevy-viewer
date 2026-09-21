import { HevyCredentials } from "./types";

const AUTH_CACHE_KEY = "hevy-viewer-auth";

export function cacheCredentials(session: HevyCredentials): void {
  window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ token: session.token }));
}

export function readCachedCredentials(): HevyCredentials | null {
  const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { token?: unknown };
    if (typeof parsed.token === "string" && parsed.token) {
      return { token: parsed.token };
    }
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  // Older versions stored the Hevy password here. Drop it and ask for a fresh sign-in.
  window.localStorage.removeItem(AUTH_CACHE_KEY);
  return null;
}

export function clearCachedCredentials(): void {
  window.localStorage.removeItem(AUTH_CACHE_KEY);
}
