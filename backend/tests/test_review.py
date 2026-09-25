import pytest

from hevy_program import build_program, review_workout
from helpers import bench, make_exercise, make_set, make_workout, payload


def test_beating_the_target_weight_and_reps_is_exceeded():
    # target after (100,5)x3 is add_weight to 102.27 x floor(3-5)=3; lifting 110x5 clears it easily
    workouts = [make_workout(i, [bench(100, 5)]) for i in range(3)] + [make_workout(3, [bench(110, 5)])]
    review = review_workout(payload(workouts))
    assert review["exercises"][-1]["status"] == "exceeded"
    assert review["score_pct"] == 100 and review["verdict"] == "ahead"


def test_falling_well_short_of_the_target_is_short():
    workouts = [make_workout(i, [bench(100, 5)]) for i in range(3)] + [make_workout(3, [bench(60, 3)])]
    review = review_workout(payload(workouts))
    assert review["exercises"][0]["status"] == "short"
    assert review["score_pct"] == 0 and review["verdict"] == "behind"


def test_hitting_the_target_almost_exactly_is_met_not_short_or_exceeded():
    workouts = [make_workout(i, [bench(100, 6)]) for i in range(3)] + [make_workout(3, [bench(100, 7)])]
    review = review_workout(payload(workouts))
    assert review["exercises"][0]["status"] == "met"  # add_reps target was 100x7, exactly matched


def test_first_time_lifts_are_a_baseline_and_do_not_count_toward_the_score():
    workouts = [make_workout(0, [bench(100, 5)])]
    review = review_workout(payload(workouts))
    assert review["exercises"][0]["status"] == "baseline" and review["exercises"][0]["target"] is None
    assert review["compared"] == 0 and review["score_pct"] is None and review["verdict"] == "new"


def test_defaults_to_the_most_recently_logged_workout():
    workouts = [make_workout(i, [bench(100, 5)]) for i in range(3)]
    review = review_workout(payload(workouts))
    assert review["workout_id"] == workouts[-1]["id"]


def test_can_review_an_older_workout_by_id():
    workouts = [make_workout(i, [bench(100, 5)]) for i in range(3)]
    review = review_workout(payload(workouts), workout_id="w1")
    assert review["workout_id"] == "w1"


def test_no_workouts_returns_none():
    assert review_workout(payload([])) is None


def test_unknown_workout_id_returns_none():
    assert review_workout(payload([make_workout(0, [bench(100, 5)])]), workout_id="nope") is None


def test_multiple_lifts_mix_of_statuses_averages_into_the_score():
    beat = make_exercise("Row", "upper_back", [make_set(100, 5)])
    miss = make_exercise("Curl", "biceps", [make_set(20, 10)])
    prior = [make_workout(i, [beat, miss]) for i in range(3)]
    session = make_workout(3, [make_exercise("Row", "upper_back", [make_set(110, 5)]), make_exercise("Curl", "biceps", [make_set(10, 3)])])
    review = review_workout(payload(prior + [session]))
    statuses = {entry["name"]: entry["status"] for entry in review["exercises"]}
    assert statuses["Row"] == "exceeded" and statuses["Curl"] == "short"
    assert review["score_pct"] == 50 and review["verdict"] == "on_plan"


def test_build_program_includes_the_latest_review():
    workouts = [make_workout(i, [bench(100, 5)]) for i in range(4)]
    result = build_program(payload(workouts))
    assert result["latest_review"]["workout_id"] == workouts[-1]["id"]
