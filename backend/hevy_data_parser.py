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
                        "routine_id": workout.get("routine_id"),
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
                        "routine_id": workout.get("routine_id"),
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


def list_routines(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Build routine summaries from a cached Hevy payload.

    Routine definitions come from ``/v1/routines`` while workout history keeps
    the routine id on each workout.  Keeping both sources in the summary makes
    this useful even when a routine has not been performed yet.
    """
    routines = payload.get("routines")
    if not isinstance(routines, list):
        raise ValueError("Expected payload['routines'] to be a list")

    summaries: list[dict[str, Any]] = []
    for routine in routines:
        if not isinstance(routine, Mapping):
            continue
        routine_id = _routine_id(routine)
        if not routine_id:
            continue

        analytics = aggregate_routine_metrics(
            {"workouts": payload.get("workouts", [])}, routine_id
        )
        exercises = routine.get("exercises")
        exercise_names: list[str] = []
        if isinstance(exercises, list):
            exercise_names = sorted(
                {
                    _exercise_name(exercise)
                    for exercise in exercises
                    if isinstance(exercise, Mapping)
                },
                key=str.lower,
            )
        summaries.append(
            {
                "id": routine_id,
                "name": _routine_name(routine),
                "title": _routine_name(routine),
                "exercise_count": len(exercises) if isinstance(exercises, list) else 0,
                "exercises": exercise_names,
                "workout_count": analytics["workout_count"],
                "total_volume_kg": analytics["total_volume_kg"],
                "total_estimated_1rm_kg": analytics["total_estimated_1rm_kg"],
                "last_workout": analytics["comparison_points"][-1]["time"]
                if analytics["comparison_points"]
                else None,
            }
        )

    summaries.sort(key=lambda item: str(item["name"]).lower())
    return summaries


def parse_hevy_routines(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Parse a cached routines response into frontend-ready summaries."""
    return list_routines(payload)


def aggregate_routine_metrics(
    payload_or_workouts: Mapping[str, Any] | Iterable[Mapping[str, Any]],
    routine_id: str,
) -> dict[str, Any]:
    """Aggregate volume and summed Epley estimates for one routine.

    The returned ``comparison_points`` contains one point per workout, sorted
    chronologically.  A routine's estimated 1RM is the sum of each valid set's
    Epley estimate, rather than only the best set.
    """
    if isinstance(payload_or_workouts, Mapping):
        workouts = payload_or_workouts.get("workouts")
        if not isinstance(workouts, list):
            raise ValueError("Expected payload['workouts'] to be a list")
    else:
        workouts = payload_or_workouts

    normalized_routine_id = str(routine_id)
    points: list[dict[str, Any]] = []
    total_volume = 0.0
    total_estimated_1rm = 0.0
    saw_flattened_entries = False

    for workout in workouts:
        if not isinstance(workout, Mapping):
            continue
        if "exercises" not in workout and "exercise" in workout:
            saw_flattened_entries = True
            if str(workout.get("routine_id") or "") != normalized_routine_id:
                continue
            workout_id = str(workout.get("workout_id") or "")
            if not workout_id:
                continue
            point = next(
                (candidate for candidate in points if candidate["workout_id"] == workout_id),
                None,
            )
            if point is None:
                point = {
                    "workout_id": workout_id,
                    "time": str(workout.get("workout_start") or ""),
                    "volume_kg": 0.0,
                    "estimated_1rm_kg": 0.0,
                }
                points.append(point)
            point["volume_kg"] += _set_volume(workout)
            point["estimated_1rm_kg"] += _set_estimated_1rm(workout)
            continue
        if str(workout.get("routine_id") or "") != normalized_routine_id:
            continue

        workout_volume = 0.0
        workout_estimated_1rm = 0.0
        exercises = workout.get("exercises")
        if isinstance(exercises, list):
            for exercise in exercises:
                if not isinstance(exercise, Mapping):
                    continue
                sets = exercise.get("sets")
                if not isinstance(sets, list):
                    continue
                for set_data in sets:
                    if not isinstance(set_data, Mapping):
                        continue
                    workout_volume += _set_volume(set_data)
                    workout_estimated_1rm += _set_estimated_1rm(set_data)

        point = {
            "workout_id": str(workout.get("id") or ""),
            "time": _workout_start(workout.get("start_time")),
            "volume_kg": round(workout_volume, 2),
            "estimated_1rm_kg": round(workout_estimated_1rm, 2),
        }
        points.append(point)
        total_volume += workout_volume
        total_estimated_1rm += workout_estimated_1rm

    if saw_flattened_entries:
        total_volume = sum(float(point["volume_kg"]) for point in points)
        total_estimated_1rm = sum(float(point["estimated_1rm_kg"]) for point in points)
    for point in points:
        point["volume_kg"] = round(float(point["volume_kg"]), 2)
        point["estimated_1rm_kg"] = round(float(point["estimated_1rm_kg"]), 2)
    points.sort(key=lambda item: _parse_time(item["time"]))
    return {
        "routine_id": normalized_routine_id,
        "workout_count": len(points),
        "total_volume_kg": round(total_volume, 2),
        "total_estimated_1rm_kg": round(total_estimated_1rm, 2),
        "comparison_points": points,
    }


def routine_analytics(
    payload: Mapping[str, Any], routine_id: str
) -> dict[str, Any]:
    """Compatibility-friendly name for :func:`aggregate_routine_metrics`."""
    return aggregate_routine_metrics(payload, routine_id)


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


def _set_estimated_1rm(entry: Mapping[str, Any]) -> float:
    reps = _to_float(entry.get("reps"))
    weight_kg = _to_float(entry.get("weight_kg"))
    if reps <= 0 or weight_kg <= 0:
        return 0.0
    return weight_kg * (1 + reps / 30)


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
        return datetime.min.replace(tzinfo=timezone.utc)
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


def _workout_start(value: Any) -> str:
    """Return workout timestamps in the ISO format expected by the graph API."""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    if isinstance(value, str):
        return value
    return ""


def _routine_id(routine: Mapping[str, Any]) -> str:
    value = routine.get("id", routine.get("routine_id"))
    return str(value) if value is not None else ""


def _routine_name(routine: Mapping[str, Any]) -> str:
    return _first_string(routine, ("title", "name", "routine_name"), default="Untitled Routine")


def _to_key(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    return "-".join(part for part in cleaned.split("-") if part) or "unknown-exercise"
