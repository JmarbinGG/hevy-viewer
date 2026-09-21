import pytest

from hevy_data_parser import aggregate_routine_metrics, list_workouts
from helpers import bench, make_exercise, make_set, make_workout, payload


def points(workouts):
    return aggregate_routine_metrics(payload(workouts), "push")["comparison_points"]


def test_stronger_lift_is_positive_change():
    latest = points([make_workout(0, [bench(100, 5)]), make_workout(1, [bench(105, 5)])])[-1]
    assert latest["vs_previous"]["available"]
    assert latest["vs_previous"]["performance_change_pct"] == pytest.approx(5.0, abs=0.1)
    assert latest["vs_previous"]["status"] == "improved"


def test_fewer_sets_is_not_worse():
    latest = points([make_workout(0, [bench(100, 5, sets=4)]), make_workout(1, [bench(100, 5, sets=1)])])[-1]
    comparison = latest["vs_previous"]
    assert comparison["performance_change_pct"] == pytest.approx(0.0, abs=0.1)
    assert comparison["status"] == "similar"
    assert comparison["volume_change_pct"] < 0  # volume did drop, strength did not


def test_warmup_sets_do_not_count_as_strength():
    heavy_warmup = make_exercise("Bench Press", "chest", [make_set(200, 5, warmup=True), make_set(100, 5)])
    latest = points([make_workout(0, [bench(100, 5)]), make_workout(1, [heavy_warmup])])[-1]
    assert latest["vs_previous"]["performance_change_pct"] == pytest.approx(0.0, abs=0.1)


def test_swapped_lift_for_same_muscle_still_compares():
    before = make_exercise("Chest Fly (Machine)", "chest", [make_set(40, 10)])
    after = make_exercise("Chest Fly (Cable)", "chest", [make_set(22, 10)])
    comparison = points([make_workout(0, [before]), make_workout(1, [after])])[-1]["vs_previous"]
    assert comparison["available"]
    row = comparison["muscles"][0]
    assert row["basis"] == "swapped"
    assert row["swap_from"] == ["Chest Fly (Machine)"] and row["swap_to"] == ["Chest Fly (Cable)"]


def test_same_lift_uses_direct_comparison():
    comparison = points([make_workout(0, [bench(100, 5)]), make_workout(1, [bench(110, 5)])])[-1]["vs_previous"]
    row = comparison["muscles"][0]
    assert row["basis"] == "same"
    assert row["lifts"][0]["name"] == "Bench Press"


def test_too_few_shared_muscle_groups_is_not_comparable():
    before = make_workout(0, [bench(100, 5)])
    after = make_workout(1, [
        make_exercise("Squat", "quadriceps", [make_set(100, 5)]),
        make_exercise("Curl", "biceps", [make_set(20, 10)]),
        make_exercise("Row", "lats", [make_set(60, 8)]),
        bench(100, 5),
    ])
    comparison = points([before, after])[-1]["vs_previous"]
    assert comparison["available"] is False
    assert comparison["reason"] == "insufficient_similarity"


def test_first_session_has_no_baseline():
    comparison = points([make_workout(0, [bench(100, 5)])])[0]["vs_previous"]
    assert comparison == {"available": False, "reason": "no_baseline", "sample_size": 0}


def test_rolling_average_uses_last_four_sessions():
    weights = [50, 100, 100, 100, 100, 110]
    latest = points([make_workout(i, [bench(w, 5)]) for i, w in enumerate(weights)])[-1]
    rolling = latest["vs_rolling"]
    assert rolling["sample_size"] == 4
    assert rolling["performance_change_pct"] == pytest.approx(10.0, abs=0.1)  # the 50 kg session is outside the window


def test_performance_index_starts_at_100_and_tracks_strength():
    indexes = [p["performance_index"] for p in points([make_workout(0, [bench(100, 5)]), make_workout(1, [bench(110, 5)])])]
    assert indexes[0] == 100.0
    assert indexes[1] == pytest.approx(110.0, abs=0.1)


def test_list_workouts_includes_workouts_outside_a_routine():
    result = list_workouts(payload([make_workout(0, [bench(100, 5)]), make_workout(1, [bench(90, 5)], routine_id=None, name="Evening workout")]))
    assert [w["routine_id"] for w in result] == ["push", None]
    assert result[1]["name"] == "Evening workout"
    assert result[1]["set_count"] == 3
    assert result[1]["duration_min"] == 60.0
