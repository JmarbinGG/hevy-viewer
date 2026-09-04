"""
Helpers for parsing data returned by hevy_login.py and grouping it for analysis.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Mapping

ParsedEntry = dict[str, Any]
GroupKeyGetter = Callable[[Mapping[str, Any]], str]


def parse_hevy_login_data(payload: Mapping[str, Any]) -> list[ParsedEntry]:
    """
    Flatten the hevy_login.py payload into per-set entries.

    Expected payload shape is the JSON object printed by backend/hevy_login.py,
    including a top-level "workouts" list.
    """
    workouts = payload.get("workouts")
    if not isinstance(workouts, list):
        raise ValueError("Expected payload['workouts'] to be a list")

    parsed: list[ParsedEntry] = []
    for workout in workouts:
        if not isinstance(workout, Mapping):
            continue

        exercises = workout.get("exercises")
        if not isinstance(exercises, list):
            continue

        for exercise in exercises:
            if not isinstance(exercise, Mapping):
                continue

            exercise_name = _exercise_name(exercise)
            muscle_group = _muscle_group(exercise)
            sets = exercise.get("sets")

            if not isinstance(sets, list) or not sets:
                parsed.append(
                    {
                        "workout_id": workout.get("id"),
                        "workout_title": workout.get("title"),
                        "workout_start": _workout_start(workout.get("start_time")),
                        "exercise": exercise_name,
                        "muscle_group": muscle_group,
                    }
                )
                continue

            for idx, set_data in enumerate(sets, start=1):
                if not isinstance(set_data, Mapping):
                    continue

                parsed.append(
                    {
                        "workout_id": workout.get("id"),
                        "workout_title": workout.get("title"),
                        "workout_start": _workout_start(workout.get("start_time")),
                        "exercise": exercise_name,
                        "muscle_group": muscle_group,
                        "set_index": idx,
                        "set_type": set_data.get("type"),
                        "reps": set_data.get("reps"),
                        "weight_kg": set_data.get("weight_kg"),
                        "duration_seconds": set_data.get("duration_seconds"),
                        "distance_meters": set_data.get("distance_meters"),
                        "rpe": set_data.get("rpe"),
                    }
                )
    return parsed


def group_parsed_data(entries: Iterable[Mapping[str, Any]], group_by: str) -> dict[str, list[ParsedEntry]]:
    """
    Group parsed entries by a registered grouping strategy.

    Built-in group_by values:
    - "muscle_group"
    - "exercise"
    """
    key_getter = GROUPING_STRATEGIES.get(group_by)
    if key_getter is None:
        supported = ", ".join(sorted(GROUPING_STRATEGIES))
        raise ValueError(f"Unsupported group_by '{group_by}'. Supported values: {supported}")

    grouped: defaultdict[str, list[ParsedEntry]] = defaultdict(list)
    for entry in entries:
        key = key_getter(entry)
        grouped[key].append(dict(entry))

    return dict(grouped)


def register_grouping_strategy(name: str, key_getter: GroupKeyGetter) -> None:
    """Register additional grouping dimensions."""
    if not name:
        raise ValueError("Grouping strategy name must be non-empty")
    GROUPING_STRATEGIES[name] = key_getter


def _exercise_name(exercise: Mapping[str, Any]) -> str:
    return _first_string(
        exercise,
        (
            "title",
            "exercise_title",
            "name",
            "exercise_name",
        ),
        default="Unknown Exercise",
    )


def _muscle_group(exercise: Mapping[str, Any]) -> str:
    direct = _first_string(
        exercise,
        (
            "primary_muscle_group",
            "muscle_group",
            "primaryMuscleGroup",
            "muscleGroup",
        ),
        default="Unknown Muscle Group",
    )
    if direct != "Unknown Muscle Group":
        return direct

    nested = exercise.get("exercise")
    if isinstance(nested, Mapping):
        return _first_string(
            nested,
            (
                "primary_muscle_group",
                "muscle_group",
                "primaryMuscleGroup",
                "muscleGroup",
            ),
            default="Unknown Muscle Group",
        )
    return "Unknown Muscle Group"


def _first_string(data: Mapping[str, Any], keys: tuple[str, ...], default: str) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return default


GROUPING_STRATEGIES: dict[str, GroupKeyGetter] = {
    "muscle_group": lambda entry: str(entry.get("muscle_group") or "Unknown Muscle Group"),
    "exercise": lambda entry: str(entry.get("exercise") or "Unknown Exercise"),
}


def list_exercises(entries: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """
    Build a normalized exercise list suitable for UI navigation.
    """
    by_name: dict[str, dict[str, Any]] = {}
    for entry in entries:
        exercise = str(entry.get("exercise") or "Unknown Exercise")
        muscle_group = str(entry.get("muscle_group") or "Unknown Muscle Group")
        volume = _set_volume(entry)
        workout_id = entry.get("workout_id")

        if exercise not in by_name:
            by_name[exercise] = {
                "id": _to_key(exercise),
                "name": exercise,
                "muscle_groups": set(),
                "workout_ids": set(),
                "set_count": 0,
                "total_volume_kg": 0.0,
            }

        current = by_name[exercise]
        current["muscle_groups"].add(muscle_group)
        if entry.get("set_index") is not None:
            current["set_count"] += 1
        current["total_volume_kg"] += volume
        if workout_id is not None:
            current["workout_ids"].add(str(workout_id))

    normalized: list[dict[str, Any]] = []
    for value in by_name.values():
        normalized.append(
            {
                "id": value["id"],
                "name": value["name"],
                "muscle_groups": sorted(value["muscle_groups"]),
                "workout_count": len(value["workout_ids"]),
                "set_count": value["set_count"],
                "total_volume_kg": round(float(value["total_volume_kg"]), 2),
            }
        )

    normalized.sort(key=lambda item: (-item["workout_count"], -item["set_count"], item["name"].lower()))
    return normalized


def volume_over_time(entries: Iterable[Mapping[str, Any]], exercise_name: str) -> list[dict[str, Any]]:
    """
    Aggregate volume (weight * reps) by workout date for one exercise.
    """
    per_workout: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if str(entry.get("exercise") or "") != exercise_name:
            continue

        workout_id = str(entry.get("workout_id") or "")
        workout_start = str(entry.get("workout_start") or "")
        if not workout_id:
            continue

        bucket = per_workout.get(workout_id)
        if bucket is None:
            bucket = {
                "workout_id": workout_id,
                "time": workout_start,
                "volume_kg": 0.0,
            }
            per_workout[workout_id] = bucket

        bucket["volume_kg"] += _set_volume(entry)

    points = [
        {
            "workout_id": value["workout_id"],
            "time": value["time"],
            "volume_kg": round(float(value["volume_kg"]), 2),
        }
        for value in per_workout.values()
    ]
    points.sort(key=lambda item: _parse_time(item["time"]))
    return points

def max_over_time(entries: Iterable[Mapping[str, Any]], exercise_name: str) -> list[dict[str, Any]]:
    """
    Aggregate max (heaviest weight lifted during exercise) by workout date for one exercise.
    """
    per_workout: dict[str, dict[str, Any]] = {}

    for entry in entries:
        if str(entry.get("exercise") or "") != exercise_name:
            continue

        workout_id = str(entry.get("workout_id") or "")
        workout_start = str(entry.get("workout_start") or "")
        if not workout_id:
            continue

        bucket = per_workout.get(workout_id)
        if bucket is None:
            bucket = {
                "workout_id": workout_id,
                "time": workout_start,
                "max_weight_kg": 0.0,
            }
            per_workout[workout_id] = bucket

        bucket["max_weight_kg"] = max(bucket["max_weight_kg"], _set_max(entry))

    points = [
        {
            "workout_id": value["workout_id"],
            "time": value["time"],
            "max_weight_kg": round(float(value["max_weight_kg"]), 2),
        }
        for value in per_workout.values()
    ]
    points.sort(key=lambda item: _parse_time(item["time"]))
    return points


def one_rep_max_over_time(entries: Iterable[Mapping[str, Any]], exercise_name: str) -> list[dict[str, Any]]:
    """Estimate the heaviest one-repetition maximum per workout using Epley's formula."""
    per_workout: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if str(entry.get("exercise") or "") != exercise_name:
            continue
        workout_id = str(entry.get("workout_id") or "")
        if not workout_id:
            continue
        reps = _to_float(entry.get("reps"))
        weight = _to_float(entry.get("weight_kg"))
        if reps <= 0 or weight <= 0:
            continue
        bucket = per_workout.setdefault(
            workout_id,
            {
                "workout_id": workout_id,
                "time": str(entry.get("workout_start") or ""),
                "one_rep_max_kg": 0.0,
            },
        )
        estimated = weight * (1 + reps / 30)
        bucket["one_rep_max_kg"] = max(bucket["one_rep_max_kg"], estimated)

    points = [
        {
            "workout_id": value["workout_id"],
            "time": value["time"],
            "one_rep_max_kg": round(float(value["one_rep_max_kg"]), 2),
        }
        for value in per_workout.values()
    ]
    points.sort(key=lambda item: _parse_time(item["time"]))
    return points

def _set_volume(entry: Mapping[str, Any]) -> float:
    reps = _to_float(entry.get("reps"))
    weight_kg = _to_float(entry.get("weight_kg"))
    if reps <= 0 or weight_kg <= 0:
        return 0.0
    return reps * weight_kg

def _set_max(entry: Mapping[str, Any]) -> float:
    weight_kg = _to_float(entry.get("weight_kg"))
    if weight_kg <= 0:
        return 0.0
    return weight_kg


def _to_float(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return 0.0
    return 0.0


def _parse_time(value: str) -> datetime:
    if not value:
        return datetime.min
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return datetime.min


def _workout_start(value: Any) -> str:
    """Return workout timestamps in the ISO format expected by the graph API."""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    if isinstance(value, str):
        return value
    return ""


def _to_key(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    return "-".join(part for part in cleaned.split("-") if part) or "unknown-exercise"
