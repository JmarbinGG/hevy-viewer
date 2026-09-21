import pytest

from hevy_data_parser import list_prs
from helpers import make_exercise, make_set, make_workout, payload


def pr(kind, value):
    return {"type": kind, "value": value}


def session(index, sets):
    return make_workout(index, [make_exercise("Bench Press", "chest", sets)])


def test_first_record_is_marked_and_later_ones_compare_to_it():
    result = list_prs(payload([
        session(0, [make_set(100, 5, prs=[pr("best_weight", 100)])]),
        session(1, [make_set(110, 5, prs=[pr("best_weight", 110)])]),
    ]))
    newest, oldest = result["prs"]
    assert oldest["is_first"] and oldest["change_pct"] is None
    assert not newest["is_first"]
    assert newest["previous_value"] == 100
    assert newest["change_pct"] == pytest.approx(10.0)


def test_one_entry_per_session_keeps_the_best_value():
    result = list_prs(payload([session(0, [
        make_set(100, 5, prs=[pr("best_1rm", 116.7)]),
        make_set(105, 5, prs=[pr("best_1rm", 122.5)]),
    ])]))
    assert len(result["prs"]) == 1
    assert result["prs"][0]["value"] == 122.5
    assert result["prs"][0]["weight_kg"] == 105


def test_records_hold_current_best_per_type_newest_first():
    result = list_prs(payload([
        session(0, [make_set(100, 5, prs=[pr("best_weight", 100), pr("best_1rm", 116.7)])]),
        session(1, [make_set(110, 3, prs=[pr("best_weight", 110)])]),
    ]))
    record = result["records"][0]
    assert record["exercise"] == "Bench Press"
    assert record["bests"]["best_weight"]["value"] == 110
    assert record["bests"]["best_1rm"]["value"] == 116.7


def test_unknown_or_empty_flags_are_ignored():
    result = list_prs(payload([session(0, [make_set(100, 5, prs=[pr("best_mystery", 5), pr("best_weight", 0)])])]))
    assert result["prs"] == []


def test_each_record_compares_to_the_best_so_far_not_the_first():
    result = list_prs(payload([
        session(0, [make_set(100, 5, prs=[pr("best_weight", 100)])]),
        session(1, [make_set(110, 5, prs=[pr("best_weight", 110)])]),
        session(2, [make_set(120, 5, prs=[pr("best_weight", 120)])]),
    ]))
    latest = result["prs"][0]
    assert latest["previous_value"] == 110
    assert latest["change_pct"] == pytest.approx(9.1, abs=0.1)
