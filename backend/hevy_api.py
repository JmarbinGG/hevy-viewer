from __future__ import annotations

import argparse
import asyncio
import os
from datetime import date
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from urllib.parse import unquote

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
import logging

from hevy_data_parser import (
    list_exercises,
    max_over_time,
    one_rep_max_over_time,
    parse_hevy_login_data,
    volume_over_time,
)
from hevy_login import (
    DEFAULT_DATA_FILE,
    fetch_account,
    get_recaptcha_token,
    hevy_login,
    load_payload,
    refresh_payload,
    require_env,
)

from ratelimit import limits, sleep_and_retry

ExerciseGraphBuilder = Callable[[list[dict[str, Any]], str], list[dict[str, Any]]]


@dataclass(frozen=True)
class HevyCredentials:
    email_or_username: str
    password: str


def _fetch_payload(credentials: HevyCredentials) -> dict[str, Any]:
    cached = load_payload(os.getenv("HEVY_DATA_FILE", DEFAULT_DATA_FILE))
    if cached is not None:
        return cached
    return _refresh_payload(credentials)


def _refresh_payload(credentials: HevyCredentials) -> dict[str, Any]:
    x_api_key = require_env("X_API_KEY")
    recaptcha_site_key = require_env("RECAPTCHA_SITE_KEY")

    recaptcha_token = asyncio.run(get_recaptcha_token(recaptcha_site_key))
    login_data = hevy_login(credentials.email_or_username, credentials.password, recaptcha_token, x_api_key)
    access_token = login_data["access_token"]

    account = fetch_account(access_token, x_api_key)
    username = account.get("username")
    if not username:
        raise RuntimeError("Account response does not include username")

    return refresh_payload(
        access_token,
        x_api_key,
        username=username,
        account=account,
        user_id=login_data.get("user_id"),
        output_path=os.getenv("HEVY_DATA_FILE", DEFAULT_DATA_FILE),
    )


def _parse_credentials(payload: Mapping[str, Any] | None) -> HevyCredentials:
    if payload is None:
        raise ValueError("Expected JSON request body")

    email_or_username = payload.get("email_or_username")
    password = payload.get("password")
    if not isinstance(email_or_username, str) or not email_or_username.strip():
        raise ValueError("email_or_username is required")
    if not isinstance(password, str) or not password:
        raise ValueError("password is required")

    return HevyCredentials(email_or_username=email_or_username.strip(), password=password)


GRAPH_BUILDERS: dict[str, ExerciseGraphBuilder] = {
    "volume_over_time": volume_over_time,
    "max_over_time": max_over_time,
    "one_rep_max_over_time": one_rep_max_over_time,
}


def create_app() -> Flask:
    load_dotenv()
    app = Flask(__name__)
    CORS(app)
    logging.getLogger('flask_cors').level = logging.DEBUG

    @app.after_request
    def add_cors_headers(response):  # type: ignore[no-untyped-def]
        allowed_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
        response.headers["Access-Control-Allow-Origin"] = allowed_origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    @app.get("/health")
    def health() -> Any:
        return jsonify({"status": "ok"})

    @app.get("/api/data-status")
    def data_status() -> Any:
        payload = load_payload(os.getenv("HEVY_DATA_FILE", DEFAULT_DATA_FILE))
        if payload is None:
            return jsonify({"exists": False, "last_updated": None, "needs_refresh": True})
        last_updated = payload.get("last_updated")
        return jsonify(
            {
                "exists": True,
                "last_updated": last_updated,
                "workout_count": len(payload.get("workouts", [])),
                "needs_refresh": last_updated != date.today().isoformat(),
            }
        )

    @app.post("/api/auth/login")
    @sleep_and_retry
    @limits(calls=5,period=60)
    def login() -> Any:
        credentials = _parse_credentials(request.get_json(silent=True))
        payload = _fetch_payload(credentials)
        account = payload["account"]
        return jsonify(
            {
                "user": {
                    "username": account.get("username"),
                    "email": account.get("email"),
                }
            }
        )

    @app.post("/api/data-refresh")
    @sleep_and_retry
    @limits(calls=5, period=60)
    def data_refresh() -> Any:
        credentials = _parse_credentials(request.get_json(silent=True))
        payload = _refresh_payload(credentials)
        return jsonify(
            {
                "last_updated": payload["last_updated"],
                "workout_count": len(payload["workouts"]),
            }
        )

    @app.post("/api/exercises")
    @sleep_and_retry
    @limits(calls=5,period=60)
    def exercises() -> Any:
        credentials = _parse_credentials(request.get_json(silent=True))
        payload = _fetch_payload(credentials)
        entries = parse_hevy_login_data(payload)
        return jsonify({"exercises": list_exercises(entries)})

    @app.post("/api/exercises/<path:exercise_name>/graphs/<graph_name>")
    @sleep_and_retry
    @limits(calls=5,period=60)
    def exercise_graph(exercise_name: str, graph_name: str) -> Any:
        builder = GRAPH_BUILDERS.get(graph_name)
        if builder is None:
            return jsonify(
                {
                    "error": "Unsupported graph",
                    "supported_graphs": sorted(GRAPH_BUILDERS.keys()),
                }
            ), 404

        credentials = _parse_credentials(request.get_json(silent=True))
        payload = _fetch_payload(credentials)
        entries = parse_hevy_login_data(payload)
        normalized_name = unquote(exercise_name)
        points = builder(entries, normalized_name)

        return jsonify(
            {
                "exercise": normalized_name,
                "graph": graph_name,
                "points": points,
            }
        )

    @app.errorhandler(ValueError)
    def handle_value_error(error: ValueError) -> Any:
        return jsonify({"error": str(error)}), 400

    @app.errorhandler(requests.HTTPError)
    def handle_http_error(error: requests.HTTPError) -> Any:
        status = error.response.status_code if error.response is not None else 502
        if status == 401:
            return jsonify({"error": "Invalid Hevy credentials"}), 401
        return jsonify({"error": f"Hevy request failed ({status})"}), 502

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Flask API for Hevy exercise analytics")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    create_app().run(host=args.host, port=args.port, debug=args.debug)
