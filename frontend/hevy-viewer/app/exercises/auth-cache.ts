import { HevyCredentials } from "./types";

const AUTH_CACHE_KEY = "hevy-viewer-auth";

export function cacheCredentials(credentials: HevyCredentials): void {
  window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(credentials));
}

export function readCachedCredentials(): HevyCredentials | null {
  const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<HevyCredentials>;
    if (
      typeof parsed.email_or_username === "string" &&
      parsed.email_or_username.trim() &&
      typeof parsed.password === "string" &&
      parsed.password.length > 0
    ) {
      return {
        email_or_username: parsed.email_or_username.trim(),
        password: parsed.password,
      };
    }
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      window.localStorage.removeItem(AUTH_CACHE_KEY);
      return null;
    }
    throw error;
  }

  return null;
}

export function clearCachedCredentials(): void {
  window.localStorage.removeItem(AUTH_CACHE_KEY);
}
