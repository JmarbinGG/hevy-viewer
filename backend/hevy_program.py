"""Next-session plans and stall detection.

Each lift follows double progression: add reps at the same weight until the top of
its rep range, then add weight and drop back to the bottom of the range.  A lift is
*stalled* when it has gone several sessions without a new best estimated 1RM; the
plan then calls for a short deload instead.
"""
from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Mapping

from hevy_data_parser import (
    _exercise_name,
    _muscle_group,
    _parse_time,
    _set_estimated_1rm,
    _to_float,
    _workout_start,
    list_routines,
)

NEW_BEST_MARGIN = 0.01        # a session counts as a new best if e1RM beats the old best by 1%
STALL_SESSIONS = 4            # sessions without a new best before a lift is "stalled"
MIN_SESSIONS_FOR_STALL = 6
DELOAD_FRACTION = 0.9
DEFAULT_STEP_KG = 2.27        # 5 lb
MIN_STEP_KG = 1.13            # 2.5 lb
RECENT_SESSIONS = 4
ASSUMED_GAP_DAYS = 7.0        # used to rank a routine that has no session history to measure a rhythm from


def _rep_range(recent_top_reps: list[float]) -> tuple[int, int]:
    """Working rep range (floor, ceiling) inferred from how many reps the lift is done for."""
    typical = statistics.median(recent_top_reps) if recent_top_reps else 8
    if typical <= 5:
        return 3, 5
    if typical <= 8:
        return 6, 8
    if typical <= 12:
        return 8, 12
    if typical <= 15:
        return 12, 15
    return round(typical * 0.8), round(typical)  # very high-rep work: stay proportional


def _step(weights: list[float], current: float) -> float:
    """Smallest weight jump seen in the history, ignoring jumps too big to be one plate change."""
    distinct = sorted({round(weight, 2) for weight in weights if weight > 0})
    largest = max(MIN_STEP_KG, current * 0.25)
    gaps = [b - a for a, b in zip(distinct, distinct[1:]) if MIN_STEP_KG - 0.01 <= b - a <= largest]
    return round(min(gaps), 2) if gaps else DEFAULT_STEP_KG


def _round_to(value: float, step: float) -> float:
    return round(round(value / step) * step, 2)


def _history(payload: Mapping[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Working-set history per exercise, oldest session first."""
    workouts = payload.get("workouts")
    if not isinstance(workouts, list):
        raise ValueError("Expected payload['workouts'] to be a list")
    ordered = sorted(
        (workout for workout in workouts if isinstance(workout, Mapping)),
        key=lambda workout: _parse_time(_workout_start(workout.get("start_time"))),
    )
    history: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for workout in ordered:
        for position, exercise in enumerate(workout.get("exercises") or []):
            if not isinstance(exercise, Mapping):
                continue
            sets = [
                (_to_float(item.get("weight_kg")), _to_float(item.get("reps")))
                for item in exercise.get("sets") or []
                if isinstance(item, Mapping) and item.get("indicator") != "warmup" and _to_float(item.get("reps")) > 0
            ]
            sets = [(weight, reps) for weight, reps in sets if weight > 0 or reps > 0]
            if not sets:
                continue
            name = _exercise_name(exercise)
            weighted = any(weight > 0 for weight, _ in sets)
            top = max(sets, key=lambda item: (item[0], item[1])) if weighted else max(sets, key=lambda item: item[1])
            history[name].append({
                "workout_id": str(workout.get("id") or ""),
                "time": _workout_start(workout.get("start_time")),
                "routine_id": str(workout.get("routine_id") or "") or None,
                "position": position,
                "muscle_group": _muscle_group(exercise),
                "image_url": exercise.get("custom_exercise_image_url") or exercise.get("thumbnail_url"),
                "set_count": len(sets),
                "weighted": weighted,
                "top": top,
                "strength": max(_set_estimated_1rm({"weight_kg": weight, "reps": reps}) for weight, reps in sets) if weighted else max(reps for _, reps in sets),
            })
    return history


def _since_best(strengths: list[float]) -> int:
    best_index = 0
    best = strengths[0]
    for index, value in enumerate(strengths[1:], start=1):
        if value > best * (1 + NEW_BEST_MARGIN):
            best, best_index = value, index
        else:
            best = max(best, value)
    return len(strengths) - 1 - best_index


def exercise_plan(name: str, sessions: list[dict[str, Any]]) -> dict[str, Any]:
    latest = sessions[-1]
    strengths = [session["strength"] for session in sessions]
    since_best = _since_best(strengths)
    count = len(sessions)
    weighted = latest["weighted"]
    recent = sessions[-RECENT_SESSIONS:]
    top_weight, top_reps = latest["top"]
    floor, ceiling = _rep_range([session["top"][1] for session in recent])
    step = _step([session["top"][0] for session in sessions[-10:]], top_weight) if weighted else 0.0
    sets = max(1, round(statistics.median(session["set_count"] for session in sessions[-3:])))

    if count < 3:
        status = "new"
    elif since_best >= STALL_SESSIONS and count >= MIN_SESSIONS_FOR_STALL:
        status = "stalled"
    elif since_best <= 1:
        status = "progressing"
    else:
        status = "steady"

    if status == "new":
        action = "repeat"
        target_weight, target_reps = top_weight, top_reps
        reason = {"code": "new", "since_best": since_best}
    elif status == "stalled" and weighted:
        usual = statistics.median(session["top"][0] for session in recent)
        action = "deload"
        # drop ~10% from the usual working weight, but never above what was lifted last time
        target_weight = min(top_weight, max(step, _round_to(usual * DELOAD_FRACTION, step)))
        target_reps = float(ceiling)
        reason = {"code": "stalled", "since_best": since_best, "deload_pct": round((1 - DELOAD_FRACTION) * 100)}
    elif not weighted:
        action = "add_reps"
        target_weight, target_reps = 0.0, top_reps + 1
        reason = {"code": "stalled" if status == "stalled" else "build_reps", "since_best": since_best, "deload_pct": 0}
    elif top_reps >= ceiling:
        action = "add_weight"
        target_weight, target_reps = round(top_weight + step, 2), float(floor)
        reason = {"code": "hit_ceiling", "ceiling": ceiling, "since_best": since_best}
    else:
        action = "add_reps"
        target_weight, target_reps = top_weight, min(float(ceiling), top_reps + 1)
        reason = {"code": "build_reps", "ceiling": ceiling, "since_best": since_best}

    return {
        "name": name,
        "muscle_group": latest["muscle_group"],
        "image_url": next((session["image_url"] for session in reversed(sessions) if session["image_url"]), None),
        "metric": "1rm" if weighted else "reps",
        "sessions": count,
        "last_time": latest["time"],
        "last_top": {"weight_kg": round(top_weight, 2), "reps": top_reps},
        "best_strength": round(max(strengths), 2),
        "since_best": since_best,
        "status": status,
        "action": action,
        "target": {
            "weight_kg": round(target_weight, 2),
            "reps": target_reps,
            "sets": sets,
            "rep_range": [floor, ceiling],
        },
        "reason": reason,
    }


EFFORT_EXCEED_RATIO = 1.02   # actual effort this far above target counts as exceeding it
EFFORT_MEET_RATIO = 0.98     # actual effort at least this fraction of target counts as meeting it


def _effort(weight_kg: float, reps: float) -> float:
    """A single number to compare a weighted or bodyweight set against a target."""
    if weight_kg > 0:
        return _set_estimated_1rm({"weight_kg": weight_kg, "reps": reps})
    return reps


def review_workout(payload: Mapping[str, Any], workout_id: str | None = None) -> dict[str, Any] | None:
    """How a workout's actual sets compared with the plan that stood before it.

    For each exercise in the workout, the plan is recomputed from only the sessions
    strictly *before* it (the same target the lift would have shown going into that
    session), then the actual top set is compared on estimated 1RM (or reps for
    bodyweight lifts). Lifts done for the very first time have no target and are
    left out of the score. ``workout_id`` defaults to the most recently logged
    workout; returns ``None`` if there is nothing to review.
    """
    workouts = payload.get("workouts")
    if not isinstance(workouts, list):
        raise ValueError("Expected payload['workouts'] to be a list")
    history = _history(payload)

    if workout_id is None:
        latest_time = max((session["time"] for sessions in history.values() for session in sessions), default=None)
        if latest_time is None:
            return None
        workout_id = next(
            session["workout_id"] for sessions in history.values() for session in sessions if session["time"] == latest_time
        )

    workout = next(
        (item for item in workouts if isinstance(item, Mapping) and str(item.get("id") or "") == workout_id),
        None,
    )
    if workout is None:
        return None

    results: list[dict[str, Any]] = []
    for name, sessions in history.items():
        index = next((position for position, session in enumerate(sessions) if session["workout_id"] == workout_id), None)
        if index is None:
            continue
        prior = sessions[:index]
        actual = sessions[index]
        entry: dict[str, Any] = {
            "name": name,
            "muscle_group": actual["muscle_group"],
            "actual": {"weight_kg": round(actual["top"][0], 2), "reps": actual["top"][1]},
        }
        if not prior:
            entry["status"] = "baseline"
            entry["target"] = None
        else:
            plan = exercise_plan(name, prior)
            target = plan["target"]
            actual_effort = _effort(actual["top"][0], actual["top"][1])
            target_effort = _effort(target["weight_kg"], target["reps"])
            ratio = actual_effort / target_effort if target_effort > 0 else 1.0
            entry["status"] = "exceeded" if ratio >= EFFORT_EXCEED_RATIO else "met" if ratio >= EFFORT_MEET_RATIO else "short"
            entry["target"] = {"weight_kg": target["weight_kg"], "reps": target["reps"]}
        results.append(entry)

    scored = [entry for entry in results if entry["status"] != "baseline"]
    exceeded = sum(1 for entry in scored if entry["status"] == "exceeded")
    met = sum(1 for entry in scored if entry["status"] == "met")
    short = sum(1 for entry in scored if entry["status"] == "short")
    score_pct = round((exceeded + met) / len(scored) * 100) if scored else None
    if score_pct is None:
        verdict = "new"
    elif score_pct >= 80:
        verdict = "ahead"
    elif score_pct >= 50:
        verdict = "on_plan"
    else:
        verdict = "behind"

    return {
        "workout_id": workout_id,
        "time": _workout_start(workout.get("start_time")),
        "workout_name": str(workout.get("name") or workout.get("title") or "Workout"),
        "routine_id": str(workout.get("routine_id") or "") or None,
        "compared": len(scored),
        "exceeded": exceeded,
        "met": met,
        "short": short,
        "score_pct": score_pct,
        "verdict": verdict,
        "exercises": sorted(results, key=lambda entry: {"short": 0, "met": 1, "baseline": 2, "exceeded": 3}[entry["status"]]),
    }


def build_program(payload: Mapping[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """A next-session plan for every routine, plus the plan for every exercise by name."""
    now = now or datetime.now(timezone.utc)
    history = _history(payload)
    plans = {name: exercise_plan(name, sessions) for name, sessions in history.items()}

    routines: list[dict[str, Any]] = []
    for summary in list_routines(payload):
        routine_id = summary["id"]
        # sessions of this routine, oldest first, keyed by time
        by_time: dict[str, list[tuple[int, str]]] = defaultdict(list)
        for name, sessions in history.items():
            for session in sessions:
                if session["routine_id"] == routine_id:
                    by_time[session["time"]].append((session["position"], name))
        times = sorted(by_time, key=_parse_time)
        if not times:
            continue
        recent_times = times[-RECENT_SESSIONS:]
        appearances: dict[str, int] = defaultdict(int)
        positions: dict[str, list[int]] = defaultdict(list)
        for time in recent_times:
            for position, name in by_time[time]:
                appearances[name] += 1
                positions[name].append(position)
        latest_names = {name for _, name in by_time[times[-1]]}
        chosen = [name for name in appearances if name in latest_names or appearances[name] >= 2]
        chosen.sort(key=lambda name: statistics.mean(positions[name]))

        last_time = _parse_time(times[-1])
        window = times[-6:]
        gaps = [(_parse_time(b) - _parse_time(a)).total_seconds() / 86400 for a, b in zip(window, window[1:])]
        typical_gap = round(statistics.median(gaps), 1) if gaps else None
        days_since = round((now - last_time).total_seconds() / 86400, 1)
        exercises = [plans[name] for name in chosen if name in plans]
        routines.append({
            "routine_id": routine_id,
            "title": summary["title"],
            "session_count": len(times),
            "last_session_time": times[-1],
            "days_since": days_since,
            "typical_gap_days": typical_gap,
            "overdue_days": round(days_since - (typical_gap if typical_gap is not None else ASSUMED_GAP_DAYS), 1),
            "stalled_count": sum(1 for plan in exercises if plan["status"] == "stalled"),
            "exercises": exercises,
        })
    routines.sort(key=lambda routine: -routine["overdue_days"])
    return {"routines": routines, "exercises": plans, "latest_review": review_workout(payload)}
