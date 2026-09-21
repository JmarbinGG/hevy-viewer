"""Builders for small synthetic Hevy payloads."""
from __future__ import annotations

from typing import Any

DAY = 24 * 60 * 60
START = 1_750_000_000


def make_set(weight: float, reps: int, *, warmup: bool = False, prs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "weight_kg": weight,
        "reps": reps,
        "indicator": "warmup" if warmup else "normal",
        "rpe": None,
        "prs": prs or [],
    }


def make_exercise(title: str, muscle: str, sets: list[dict[str, Any]], other: list[str] | None = None) -> dict[str, Any]:
    return {"title": title, "muscle_group": muscle, "other_muscles": other or [], "sets": sets, "thumbnail_url": None}


def make_workout(index: int, exercises: list[dict[str, Any]], *, routine_id: str | None = "push", name: str = "Push") -> dict[str, Any]:
    start = START + index * 7 * DAY
    return {
        "id": f"w{index}",
        "name": name,
        "routine_id": routine_id,
        "start_time": start,
        "end_time": start + 3600,
        "exercises": exercises,
    }


def bench(weight: float, reps: int, sets: int = 3) -> dict[str, Any]:
    return make_exercise("Bench Press", "chest", [make_set(weight, reps) for _ in range(sets)])


def payload(workouts: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "account": {"username": "lifter", "email": "lifter@example.com"},
        "last_updated": "2026-01-01",
        "workouts": workouts,
        "routines": [{"id": "push", "title": "Push"}],
    }
