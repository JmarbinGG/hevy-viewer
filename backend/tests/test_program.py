from datetime import datetime, timezone

import pytest

from hevy_program import build_program, exercise_plan, _history
from helpers import DAY, START, bench, make_exercise, make_set, make_workout, payload


def plan_for(weights_reps, *, title="Bench Press", sets=3, muscle="chest"):
    workouts = [
        make_workout(index, [make_exercise(title, muscle, [make_set(weight, reps) for _ in range(sets)])])
        for index, (weight, reps) in enumerate(weights_reps)
    ]
    history = _history(payload(workouts))
    return exercise_plan(title, history[title])


def test_top_of_the_rep_range_means_add_weight_and_drop_reps():
    plan = plan_for([(100, 5)] * 3 + [(100, 5)])
    assert plan["action"] == "add_weight"
    assert plan["target"]["weight_kg"] == pytest.approx(102.27)
    assert plan["target"]["reps"] == plan["target"]["rep_range"][0]


def test_below_the_top_of_the_range_means_add_a_rep_at_the_same_weight():
    plan = plan_for([(100, 6), (100, 6), (100, 6), (100, 7)])
    assert plan["action"] == "add_reps"
    assert plan["target"]["weight_kg"] == 100 and plan["target"]["reps"] == 8


def test_weight_step_follows_the_plate_jumps_in_your_history():
    plan = plan_for([(90, 8), (92.5, 8), (95, 8), (97.5, 8)])
    assert plan["target"]["weight_kg"] == pytest.approx(100.0)  # 2.5 kg jumps


def test_an_oversized_gap_between_weights_is_not_used_as_the_step():
    plan = plan_for([(20, 8), (20, 8), (60, 8)])
    assert plan["target"]["weight_kg"] == pytest.approx(62.27)  # default 5 lb, not 40 kg


def test_a_lift_with_no_new_best_for_four_sessions_is_stalled_and_gets_a_deload():
    plan = plan_for([(100, 5), (110, 5)] + [(110, 5)] * 5)
    assert plan["status"] == "stalled" and plan["since_best"] >= 4
    assert plan["action"] == "deload"
    assert plan["target"]["weight_kg"] == pytest.approx(0.9 * 110, abs=1.2)
    assert plan["target"]["reps"] == plan["target"]["rep_range"][1]
    assert plan["reason"]["deload_pct"] == 10


def test_a_short_history_is_never_called_stalled():
    assert plan_for([(100, 5)] * 5)["status"] != "stalled"


def test_a_deload_is_never_heavier_than_last_time():
    plan = plan_for([(120, 5)] * 4 + [(80, 5)] * 2)
    assert plan["action"] == "deload"
    assert plan["target"]["weight_kg"] <= 80


def test_improving_lifts_are_progressing_not_stalled():
    plan = plan_for([(100, 5), (105, 5), (110, 5), (115, 5), (120, 5), (125, 5)])
    assert plan["status"] == "progressing" and plan["since_best"] == 0


def test_new_lifts_repeat_instead_of_guessing():
    plan = plan_for([(100, 5), (100, 5)])
    assert plan["status"] == "new" and plan["action"] == "repeat"
    assert plan["target"]["weight_kg"] == 100 and plan["target"]["reps"] == 5


def test_warmups_do_not_change_the_working_weight():
    heavy_warmup = make_exercise("Bench Press", "chest", [make_set(200, 3, warmup=True), make_set(100, 6)])
    history = _history(payload([make_workout(i, [heavy_warmup]) for i in range(4)]))
    assert exercise_plan("Bench Press", history["Bench Press"])["last_top"]["weight_kg"] == 100


def test_bodyweight_lifts_progress_by_reps():
    plan = plan_for([(0, 10), (0, 11), (0, 12), (0, 12)], title="Dips", muscle="triceps")
    assert plan["metric"] == "reps" and plan["action"] == "add_reps"
    assert plan["target"]["weight_kg"] == 0 and plan["target"]["reps"] == 13


def test_high_rep_lifts_keep_a_proportional_range():
    plan = plan_for([(20, 30)] * 4, title="Wrist Extension", muscle="forearms")
    lo, hi = plan["target"]["rep_range"]
    assert hi == 30 and lo == 24


def test_routine_plan_lists_recurring_lifts_and_how_overdue_the_routine_is():
    curl = lambda: make_exercise("Curl", "biceps", [make_set(20, 10)])
    workouts = [make_workout(i, [bench(100, 5), curl()]) for i in range(4)]
    workouts.append(make_workout(4, [bench(100, 5)]))
    now = datetime.fromtimestamp(START + 4 * 7 * DAY + 10 * DAY, tz=timezone.utc)
    routine = build_program(payload(workouts), now=now)["routines"][0]
    assert routine["title"] == "Push"
    assert [e["name"] for e in routine["exercises"]] == ["Bench Press", "Curl"]  # Curl appeared in 3 of the last 4
    assert routine["typical_gap_days"] == 7.0
    assert routine["days_since"] == pytest.approx(10.0)
    assert routine["overdue_days"] == pytest.approx(3.0)


def test_lifts_dropped_from_a_routine_stop_appearing_in_its_plan():
    old = make_exercise("Old Lift", "biceps", [make_set(20, 10)])
    workouts = [make_workout(0, [bench(100, 5), old]), make_workout(1, [bench(100, 5)]), make_workout(2, [bench(100, 5)]), make_workout(3, [bench(100, 5)])]
    routine = build_program(payload(workouts))["routines"][0]
    assert [e["name"] for e in routine["exercises"]] == ["Bench Press"]


def test_most_overdue_routine_comes_first():
    a = make_workout(0, [bench(100, 5)], routine_id="push")
    b = make_workout(1, [make_exercise("Squat", "quadriceps", [make_set(100, 5)])], routine_id="legs", name="Legs")
    data = payload([a, b, make_workout(2, [bench(100, 5)], routine_id="push")])
    data["routines"].append({"id": "legs", "title": "Legs"})
    now = datetime.fromtimestamp(START + 60 * DAY, tz=timezone.utc)
    titles = [r["title"] for r in build_program(data, now=now)["routines"]]
    assert titles == ["Legs", "Push"]  # legs: 53 days since, weekly assumed; push: 46 days since, usual gap 14


def test_stalled_starts_at_exactly_four_sessions_without_a_new_best():
    climb = [(90, 5), (95, 5), (100, 5), (110, 5)]
    three_flat = plan_for(climb + [(110, 5)] * 3)
    four_flat = plan_for(climb + [(110, 5)] * 4)
    assert (three_flat["since_best"], three_flat["status"]) == (3, "steady")
    assert (four_flat["since_best"], four_flat["status"]) == (4, "stalled")
