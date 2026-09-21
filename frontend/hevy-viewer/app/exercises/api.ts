import { clearCachedCredentials } from "./auth-cache";
import {
  DataStatus,
  ExerciseGraphResponse,
  ExerciseSummary,
  HevyCredentials,
  LoginInput,
  LoginResponse,
  PrResponse,
  RoutineAnalytics,
  RoutineSummary,
  WorkoutSummary,
} from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_HEVY_API_URL ?? "http://127.0.0.1:5000";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const errorPayload = (await response.json()) as { error?: string };
      if (errorPayload.error) {
        message = errorPayload.error;
      }
    } else {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

async function request<T>(
  path: string,
  options: { session?: HevyCredentials; body?: unknown; method?: "GET" | "POST" } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.session) {
    headers.Authorization = `Bearer ${options.session.token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "POST",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new Error(`Can't reach the Hevy Viewer backend at ${API_BASE_URL}. Start it with "python hevy_api.py", then retry.`);
  }

  if (response.status === 401 && options.session) {
    clearCachedCredentials();
    if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
  }
  return parseJsonResponse<T>(response);
}

export function loginWithHevy(input: LoginInput): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", { body: input });
}

export async function logoutFromBackend(session: HevyCredentials): Promise<void> {
  try {
    await request("/api/auth/logout", { session });
  } catch {
    // Signing out locally is what matters; the token expires on its own.
  }
}

export async function fetchExercises(session: HevyCredentials): Promise<ExerciseSummary[]> {
  return (await request<{ exercises: ExerciseSummary[] }>("/api/exercises", { session })).exercises;
}

export function fetchDataStatus(session: HevyCredentials): Promise<DataStatus> {
  return request<DataStatus>("/api/data-status", { session, method: "GET" });
}

export function refreshData(session: HevyCredentials): Promise<DataStatus> {
  return request<DataStatus>("/api/data-refresh", { session });
}

export function fetchExerciseGraph(
  session: HevyCredentials,
  exerciseName: string,
  graphName: string,
): Promise<ExerciseGraphResponse> {
  return request<ExerciseGraphResponse>(`/api/exercises/${encodeURIComponent(exerciseName)}/graphs/${graphName}`, { session });
}

export async function fetchRoutines(session: HevyCredentials): Promise<RoutineSummary[]> {
  return (await request<{ routines: RoutineSummary[] }>("/api/routines", { session })).routines;
}

export function fetchRoutineAnalytics(session: HevyCredentials, routineId: string): Promise<RoutineAnalytics> {
  return request<RoutineAnalytics>(`/api/routines/${encodeURIComponent(routineId)}/analytics`, { session });
}

export async function fetchAllRoutineAnalytics(session: HevyCredentials): Promise<Record<string, RoutineAnalytics>> {
  return (await request<{ analytics: Record<string, RoutineAnalytics> }>("/api/routines/analytics", { session })).analytics;
}

export async function fetchWorkouts(session: HevyCredentials): Promise<WorkoutSummary[]> {
  return (await request<{ workouts: WorkoutSummary[] }>("/api/workouts", { session })).workouts;
}

export function fetchPrs(session: HevyCredentials): Promise<PrResponse> {
  return request<PrResponse>("/api/prs", { session });
}
