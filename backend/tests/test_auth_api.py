import json

import pytest

import hevy_api
from hevy_auth import HevyCredentials, PasswordStore, SessionStore
from helpers import bench, make_workout, payload

PASSWORD = "correct horse battery staple"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    data = tmp_path / "hevy_data.json"
    data.write_text(json.dumps(payload([make_workout(0, [bench(100, 5)]), make_workout(1, [bench(105, 5)])])))
    monkeypatch.setenv("HEVY_DATA_FILE", str(data))
    monkeypatch.setenv("HEVY_AUTH_FILE", str(tmp_path / ".auth.json"))
    app = hevy_api.create_app()
    app.config["TESTING"] = True
    client = app.test_client()
    client.auth_file = tmp_path / ".auth.json"
    return client


def login(client, identifier="lifter", password=PASSWORD):
    return client.post("/api/auth/login", json={"email_or_username": identifier, "password": password})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("path", ["/api/exercises", "/api/routines", "/api/workouts", "/api/prs", "/api/program", "/api/routines/analytics", "/api/data-status"])
def test_data_endpoints_require_a_session(client, path):
    method = client.get if path == "/api/data-status" else client.post
    response = method(path, json={"email_or_username": "lifter", "password": PASSWORD})
    assert response.status_code == 401
    assert "Invalid Hevy credentials" in response.get_json()["error"]


def test_login_returns_a_token_and_never_the_password(client):
    response = login(client)
    body = response.get_json()
    assert response.status_code == 200
    assert body["user"]["username"] == "lifter"
    assert PASSWORD not in json.dumps(body)
    assert PASSWORD not in client.auth_file.read_text()  # only a salted hash is stored


def test_token_unlocks_the_api(client):
    token = login(client).get_json()["token"]
    response = client.post("/api/workouts", headers=bearer(token))
    assert response.status_code == 200
    assert len(response.get_json()["workouts"]) == 2
    assert client.get("/api/data-status", headers=bearer(token)).status_code == 200


def test_wrong_password_is_rejected_once_a_password_is_remembered(client):
    assert login(client).status_code == 200
    assert login(client, password="wrong").status_code == 401
    assert login(client, identifier="LIFTER@example.com").status_code == 200  # email works too


def test_unknown_identifier_needs_a_real_hevy_login(client, monkeypatch):
    def refuse(credentials):
        raise RuntimeError("Hevy rejected the login request (HTTP 401).")

    monkeypatch.setattr(hevy_api, "_refresh_payload", refuse)
    assert login(client, identifier="someone-else").status_code == 401


def test_logout_revokes_the_token(client):
    token = login(client).get_json()["token"]
    assert client.post("/api/auth/logout", headers=bearer(token)).status_code == 200
    assert client.post("/api/workouts", headers=bearer(token)).status_code == 401


def test_prs_endpoint_shape(client):
    token = login(client).get_json()["token"]
    body = client.post("/api/prs", headers=bearer(token)).get_json()
    assert set(body) == {"prs", "records"}


def test_sessions_expire():
    now = [1000.0]
    store = SessionStore(ttl=60, clock=lambda: now[0])
    token = store.create(HevyCredentials("a", "b"))
    assert store.get(token) is not None
    now[0] += 61
    assert store.get(token) is None


def test_password_store_verifies_without_keeping_plaintext(tmp_path):
    store = PasswordStore(tmp_path / "auth.json")
    assert store.check("me", "pw") is None
    store.remember(["me", "ME@x.com"], "pw")
    assert store.check("ME", "pw") is True
    assert store.check("me@x.com", "nope") is False
    assert '"pw"' not in (tmp_path / "auth.json").read_text()
    assert (tmp_path / "auth.json").stat().st_mode & 0o077 == 0


def test_program_endpoint_returns_a_plan_per_routine(client):
    token = login(client).get_json()["token"]
    body = client.post("/api/program", headers=bearer(token)).get_json()
    assert set(body) == {"routines", "exercises"}
    assert body["routines"][0]["title"] == "Push"
    assert body["exercises"]["Bench Press"]["action"] in {"add_weight", "add_reps", "deload", "repeat"}
