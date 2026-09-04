import { DataStatus, ExerciseGraphResponse, ExerciseSummary, HevyCredentials, LoginResponse } from "./types";

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

export async function loginWithHevy(credentials: HevyCredentials): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  return parseJsonResponse<LoginResponse>(response);
}

export async function fetchExercises(credentials: HevyCredentials): Promise<ExerciseSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/exercises`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
    cache: "no-store",
  });
  const data = await parseJsonResponse<{ exercises: ExerciseSummary[] }>(response);
  return data.exercises;
}

export async function fetchDataStatus(): Promise<DataStatus> {
  const response = await fetch(`${API_BASE_URL}/api/data-status`, { cache: "no-store" });
  return parseJsonResponse<DataStatus>(response);
}

export async function refreshData(credentials: HevyCredentials): Promise<DataStatus> {
  const response = await fetch(`${API_BASE_URL}/api/data-refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
    cache: "no-store",
  });
  return parseJsonResponse<DataStatus>(response);
}

export async function fetchExerciseGraph(
  credentials: HevyCredentials,
  exerciseName: string,
  graphName: string,
): Promise<ExerciseGraphResponse> {
  const encodedName = encodeURIComponent(exerciseName);
  const response = await fetch(`${API_BASE_URL}/api/exercises/${encodedName}/graphs/${graphName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
    cache: "no-store",
  });
  return parseJsonResponse<ExerciseGraphResponse>(response);
}
