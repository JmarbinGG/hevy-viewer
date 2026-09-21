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

    workouts = payload.get("workouts")
    if not isinstance(workouts, list):
        raise ValueError("Expected payload['workouts'] to be a list")

    # Free-account workout history includes routine ids and names even when the
    # dedicated routines endpoint is unavailable.
    definitions: dict[str, dict[str, Any]] = {}
    for routine in routines:
        if not isinstance(routine, Mapping):
            continue
        routine_id = _routine_id(routine)
        if routine_id:
            definitions[routine_id] = dict(routine)
    for workout in workouts:
        if not isinstance(workout, Mapping):
            continue
        routine_id = str(workout.get("routine_id") or "")
        if routine_id and routine_id not in definitions:
            definitions[routine_id] = {
                "id": routine_id,
                "name": f"Routine {routine_id[:8]}",
            }

    summaries: list[dict[str, Any]] = []
    for routine in definitions.values():
        routine_id = _routine_id(routine)
        if not routine_id:
            continue

        analytics = aggregate_routine_metrics(
            {"workouts": workouts}, routine_id
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
        if not exercise_names:
            exercise_names = sorted(
                {
                    _exercise_name(exercise)
                    for workout in workouts
                    if isinstance(workout, Mapping)
                    and str(workout.get("routine_id") or "") == routine_id
                    for exercise in workout.get("exercises", [])
                    if isinstance(exercise, Mapping)
                },
                key=str.lower,
            )
        summaries.append(
            {
                "id": routine_id,
                "name": _routine_name(routine),
                "title": _routine_name(routine),
                "exercise_count": len(exercise_names),
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
                    "muscle_groups": {},
                    "effort_score": None,
                    "effort_source": "insufficient_data",
                    "normalized_performance": 0.0,
                }
                points.append(point)
            point["volume_kg"] += _set_volume(workout)
            point["estimated_1rm_kg"] += _set_estimated_1rm(workout)
            muscle_group = _entry_muscle_group(workout)
            point["muscle_groups"][muscle_group] = point["muscle_groups"].get(muscle_group, 0) + 1
            continue
        if str(workout.get("routine_id") or "") != normalized_routine_id:
            continue

        workout_volume = 0.0
        workout_estimated_1rm = 0.0
        muscle_groups: dict[str, float] = defaultdict(float)
        weighted_stimulus = 0.0
        effort_values: list[float] = []
        has_recorded_rpe = False
        exercise_stats: list[dict[str, Any]] = []
        exercises = workout.get("exercises")
        if isinstance(exercises, list):
            for exercise in exercises:
                if not isinstance(exercise, Mapping):
                    continue
                sets = exercise.get("sets")
                if not isinstance(sets, list):
                    continue
                stats = _exercise_session_stats(exercise)
                if stats is not None:
                    exercise_stats.append(stats)
                for set_data in sets:
                    if not isinstance(set_data, Mapping):
                        continue
                    workout_volume += _set_volume(set_data)
                    workout_estimated_1rm += _set_estimated_1rm(set_data)
                    set_volume = _set_volume(set_data)
                    effort, effort_source = _set_effort(set_data)
                    has_recorded_rpe = has_recorded_rpe or effort_source == "recorded_rpe"
                    if effort > 0:
                        effort_values.append(effort)
                    for muscle, contribution in _exercise_muscle_contributions(exercise).items():
                        muscle_groups[muscle] += contribution
                        weighted_stimulus += set_volume * contribution * max(effort, 0.5)

        point = {
            "workout_id": str(workout.get("id") or ""),
            "time": _workout_start(workout.get("start_time")),
            "volume_kg": round(workout_volume, 2),
            "estimated_1rm_kg": round(workout_estimated_1rm, 2),
            "muscle_groups": {key: round(value, 2) for key, value in muscle_groups.items()},
            "effort_score": round(sum(effort_values) / len(effort_values) * 100, 1) if effort_values else None,
            "effort_source": "recorded_rpe" if has_recorded_rpe else ("estimated_from_reps" if effort_values else "insufficient_data"),
            "normalized_performance": 0.0,
            "set_count": sum(int(item["sets"]) for item in exercise_stats),
            "duration_min": _workout_duration_min(workout),
            "exercises": exercise_stats,
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
        point.setdefault("muscle_groups", {})
        point.setdefault("effort_score", None)
        point.setdefault("effort_source", "insufficient_data")
        point.setdefault("normalized_performance", 0.0)
        point.setdefault("set_count", 0)
        point.setdefault("duration_min", None)
        point.setdefault("exercises", [])
    points.sort(key=lambda item: _parse_time(item["time"]))
    _apply_performance_scores(points)
    comparison = _routine_performance_comparison(points)
    return {
        "routine_id": normalized_routine_id,
        "workout_count": len(points),
        "total_volume_kg": round(total_volume, 2),
        "total_estimated_1rm_kg": round(total_estimated_1rm, 2),
        "comparison_points": points,
        "performance_comparison": comparison,
    }


def routine_analytics(
    payload: Mapping[str, Any], routine_id: str
) -> dict[str, Any]:
    """Compatibility-friendly name for :func:`aggregate_routine_metrics`."""
    return aggregate_routine_metrics(payload, routine_id)


ROLLING_WINDOW = 4
MIN_MUSCLE_OVERLAP = 0.7


def _exercise_session_stats(exercise: Mapping[str, Any]) -> dict[str, Any] | None:
    """Working-set summary for one exercise in one session.

    ``strength`` is the best Epley 1RM estimate (or best reps for bodyweight
    movements), so it reflects how hard the exercise was, not how much of it
    was done.
    """
    name = _exercise_name(exercise)
    sets = 0
    volume = 0.0
    best_1rm = 0.0
    top_weight = 0.0
    top_reps = 0.0
    best_reps = 0.0
    for set_data in exercise.get("sets") or []:
        if not isinstance(set_data, Mapping) or set_data.get("indicator") == "warmup":
            continue
        reps = _to_float(set_data.get("reps"))
        weight = _to_float(set_data.get("weight_kg"))
        if reps <= 0 and weight <= 0:
            continue
        sets += 1
        volume += _set_volume(set_data)
        best_reps = max(best_reps, reps)
        best_1rm = max(best_1rm, _set_estimated_1rm(set_data))
        if weight > top_weight or (weight == top_weight and reps > top_reps):
            top_weight, top_reps = weight, reps
    if sets == 0:
        return None
    use_1rm = best_1rm > 0
    return {
        "name": name,
        "sets": sets,
        "volume_kg": round(volume, 2),
        "top_weight_kg": round(top_weight, 2),
        "top_reps": top_reps,
        "metric": "1rm" if use_1rm else "reps",
        "strength": round(best_1rm if use_1rm else best_reps, 2),
    }


def _workout_duration_min(workout: Mapping[str, Any]) -> float | None:
    start, end = workout.get("start_time"), workout.get("end_time")
    if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start:
        return round((end - start) / 60, 1)
    return None


def _apply_performance_scores(points: list[dict[str, Any]]) -> None:
    """Give each session a volume-independent index (100 = routine's first session).

    Each exercise is scored against its own first appearance in the routine, then
    exercises are averaged with equal weight.  Doing fewer sets does not lower it.
    """
    baselines: dict[str, float] = {}
    for point in points:
        ratios: list[float] = []
        for exercise in point.get("exercises", []):
            strength = _to_float(exercise.get("strength"))
            if strength <= 0:
                continue
            key = f"{exercise['name']}|{exercise['metric']}"
            baselines.setdefault(key, strength)
            ratios.append(strength / baselines[key])
        index = round(sum(ratios) / len(ratios) * 100, 1) if ratios else 0.0
        point["performance_index"] = index
        point["normalized_performance"] = index
    for position, point in enumerate(points):
        previous = _compare_to_baseline(point, points[max(0, position - 1):position]) if position else None
        point["change_vs_previous_pct"] = (
            previous["performance_change_pct"] if previous and previous["available"] else None
        )


def _compare_to_baseline(
    current: Mapping[str, Any], baseline_points: list[Mapping[str, Any]]
) -> dict[str, Any]:
    """Compare a session with one or several earlier sessions (averaged)."""
    if not baseline_points:
        return {"available": False, "reason": "no_baseline", "sample_size": 0}

    base_strength: dict[str, list[dict[str, float]]] = defaultdict(list)
    base_muscles: dict[str, float] = defaultdict(float)
    for point in baseline_points:
        for muscle, value in (point.get("muscle_groups") or {}).items():
            base_muscles[muscle] += _to_float(value) / len(baseline_points)
        for exercise in point.get("exercises", []):
            base_strength[f"{exercise['name']}|{exercise['metric']}"].append(exercise)

    overlap = _muscle_overlap(current.get("muscle_groups") or {}, base_muscles)
    if overlap < MIN_MUSCLE_OVERLAP:
        return {
            "available": False,
            "reason": "insufficient_similarity",
            "sample_size": len(baseline_points),
            "muscle_overlap_pct": round(overlap * 100, 1),
        }

    rows: list[dict[str, Any]] = []
    matched_keys: set[str] = set()
    added: list[str] = []
    for exercise in current.get("exercises", []):
        key = f"{exercise['name']}|{exercise['metric']}"
        history = base_strength.get(key)
        if not history or _to_float(exercise["strength"]) <= 0:
            added.append(exercise["name"])
            continue
        matched_keys.add(key)
        base = sum(_to_float(item["strength"]) for item in history) / len(history)
        if base <= 0:
            continue
        rows.append({
            "name": exercise["name"],
            "metric": exercise["metric"],
            "current": exercise["strength"],
            "baseline": round(base, 2),
            "change_pct": round((_to_float(exercise["strength"]) - base) / base * 100, 1),
            "current_sets": exercise["sets"],
            "baseline_sets": round(sum(item["sets"] for item in history) / len(history), 1),
            "current_volume_kg": exercise["volume_kg"],
            "baseline_volume_kg": round(sum(_to_float(item["volume_kg"]) for item in history) / len(history), 1),
            "current_top": [exercise["top_weight_kg"], exercise["top_reps"]],
        })
    removed = [key.split("|")[0] for key in base_strength if key not in matched_keys]
    if not rows:
        return {"available": False, "reason": "no_shared_exercises", "sample_size": len(baseline_points)}

    def _avg(field: str) -> float | None:
        values = [_to_float(point.get(field)) for point in baseline_points if _to_float(point.get(field)) > 0]
        return sum(values) / len(values) if values else None

    def _pct(field: str) -> float | None:
        base, now = _avg(field), _to_float(current.get(field))
        return round((now - base) / base * 100, 1) if base and now > 0 else None

    change = sum(row["change_pct"] for row in rows) / len(rows)
    coverage = len(rows) / max(len(current.get("exercises", [])), 1)
    if overlap >= 0.85 and coverage >= 0.75:
        confidence = "high"
    else:
        confidence = "medium"
    return {
        "available": True,
        "status": "improved" if change >= 2 else "declined" if change <= -2 else "similar",
        "performance_change_pct": round(change, 1),
        "confidence": confidence,
        "sample_size": len(baseline_points),
        "muscle_overlap_pct": round(overlap * 100, 1),
        "volume_change_pct": _pct("volume_kg"),
        "set_change_pct": _pct("set_count"),
        "duration_change_pct": _pct("duration_min"),
        "baseline_time": baseline_points[-1].get("time"),
        "exercises": sorted(rows, key=lambda row: -row["change_pct"]),
        "added_exercises": added,
        "removed_exercises": removed,
    }


def _routine_performance_comparison(points: list[Mapping[str, Any]]) -> dict[str, Any]:
    """Compare the latest session with the previous one and a rolling average."""
    scored = [point for point in points if point.get("exercises")]
    if len(scored) < 2:
        return {
            "available": False,
            "status": "insufficient_data",
            "message": "Not enough sessions to compare yet.",
            "confidence": "low",
        }
    current = scored[-1]
    previous = scored[:-1]
    vs_previous = _compare_to_baseline(current, previous[-1:])
    vs_rolling = _compare_to_baseline(current, previous[-ROLLING_WINDOW:]) if len(previous) >= 2 else {
        "available": False, "reason": "no_baseline", "sample_size": len(previous),
    }
    headline = vs_previous if vs_previous["available"] else vs_rolling
    if headline["available"]:
        change = headline["performance_change_pct"]
        message = (
            "Performance was similar to your last session."
            if headline["status"] == "similar"
            else f"Performance was {abs(change):.0f}% {'higher' if change > 0 else 'lower'} than your last session."
        )
        if headline is vs_rolling:
            message = message.replace("your last session", f"your last {vs_rolling['sample_size']}-session average")
    else:
        message = "Recent sessions are too different (muscle overlap) for a reliable comparison."
    return {
        "available": bool(headline["available"]),
        "status": headline.get("status", "insufficient_similarity"),
        "message": message,
        "confidence": headline.get("confidence", "low"),
        "current": {
            "workout_id": current.get("workout_id"),
            "time": current.get("time"),
            "performance_index": current.get("performance_index"),
            "volume_kg": current.get("volume_kg"),
            "set_count": current.get("set_count"),
            "duration_min": current.get("duration_min"),
        },
        "vs_previous": vs_previous,
        "vs_rolling": vs_rolling,
    }


def _muscle_overlap(left: Mapping[str, Any], right: Mapping[str, Any]) -> float:
    keys = set(left) | set(right)
    denominator = sum(max(_to_float(left.get(key)), _to_float(right.get(key))) for key in keys)
    if denominator <= 0:
        return 0.0
    return sum(min(_to_float(left.get(key)), _to_float(right.get(key))) for key in keys) / denominator


def _exercise_muscle_contributions(exercise: Mapping[str, Any]) -> dict[str, float]:
    primary = _first_string(
        exercise,
        ("muscle_group", "primary_muscle_group", "muscleGroup"),
        default="Unknown Muscle Group",
    )
    contributions = {primary: 1.0}
    other_muscles = exercise.get("other_muscles")
    if isinstance(other_muscles, list):
        for muscle in other_muscles:
            if isinstance(muscle, str) and muscle.strip():
                contributions[muscle.strip()] = max(contributions.get(muscle.strip(), 0.0), 0.5)
    return contributions


def _entry_muscle_group(entry: Mapping[str, Any]) -> str:
    return str(entry.get("muscle_group") or "Unknown Muscle Group")


def _set_effort(entry: Mapping[str, Any]) -> tuple[float, str]:
    rpe = _to_float(entry.get("rpe"))
    if rpe > 0:
        return min(rpe / 10, 1.0), "recorded_rpe"
    reps = _to_float(entry.get("reps"))
    if reps <= 0:
        return 0.0, "insufficient_data"
    return min(0.5 + reps / 20, 1.0), "estimated_from_reps"


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
    name = _first_string(routine, ("title", "name", "routine_name"), default="Untitled Routine")
    # Hevy can retain an old routine label in cached definitions after the
    # routine has been renamed. Keep the user-facing name aligned with the
    # current routine label.
    if name.strip().casefold() == "push(strong)":
        return "Push"
    return name


def _to_key(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    return "-".join(part for part in cleaned.split("-") if part) or "unknown-exercise"
