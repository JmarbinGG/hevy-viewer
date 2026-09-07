from __future__ import annotations

import argparse
import asyncio
import os
from datetime import date
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import unquote

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
import logging

from hevy_data_parser import (
    aggregate_routine_metrics,
    list_exercises,
    list_routines,
    max_over_time,
    one_rep_max_over_time,
    parse_hevy_login_data,
    volume_over_time,
)
from hevy_login import (
    DEFAULT_DATA_FILE,
    configure_logging,
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
    data_file = os.getenv("HEVY_DATA_FILE", str(DEFAULT_DATA_FILE))
    app_logger = logging.getLogger(__name__)
    app_logger.debug("Checking Hevy cache at %s", data_file)
    cached = load_payload(data_file)
    if cached is not None and cached.get("last_updated") is not None:
        app_logger.debug("Using cached Hevy payload dated %s", cached["last_updated"])
        return cached
    app_logger.debug("Cache is missing or incomplete; starting authenticated refresh")
    return _refresh_payload(credentials)


def _refresh_payload(credentials: HevyCredentials) -> dict[str, Any]:
    x_api_key = require_env("X_API_KEY")
    recaptcha_site_key = require_env("RECAPTCHA_SITE_KEY")
    session = requests.Session()

    app_logger = logging.getLogger(__name__)
    app_logger.debug("Created HTTP session (initial cookies=%d)", len(session.cookies))
    app_logger.info("Starting Playwright reCAPTCHA token generation")
    recaptcha_token = asyncio.run(get_recaptcha_token(recaptcha_site_key))
    app_logger.info("Playwright returned a reCAPTCHA token")
    app_logger.info("Submitting Hevy login request")
    login_data = hevy_login(
        credentials.email_or_username,
        credentials.password,
        recaptcha_token,
        x_api_key,
        session=session,
    )
    app_logger.info("Hevy login returned an access token")
    access_token = login_data["access_token"]

    app_logger.info("Fetching the authenticated Hevy account")
    account = fetch_account(access_token, x_api_key, session=session)
    app_logger.info("Authenticated Hevy account request succeeded")
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
        session=session,
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

    return HevyCredentials(
        email_or_username=email_or_username.strip(),
        password=password,
    )


GRAPH_BUILDERS: dict[str, ExerciseGraphBuilder] = {
    "volume_over_time": volume_over_time,
    "max_over_time": max_over_time,
    "one_rep_max_over_time": one_rep_max_over_time,
    "one_rep_max": one_rep_max_over_time,
}


def create_app() -> Flask:
    load_dotenv(Path(__file__).with_name(".env"))
    configure_logging()
    app = Flask(__name__)
    app.logger.setLevel(logging.DEBUG if os.getenv("HEVY_VERBOSE_LOGGING", "").lower() in {"1", "true", "yes", "on"} else logging.INFO)
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
        app.logger.info("Received login request for identifier %s", credentials.email_or_username)
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
                "routine_count": len(payload.get("routines", [])),
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

    @app.post("/api/routines")
    @sleep_and_retry
    @limits(calls=5, period=60)
    def routines() -> Any:
        credentials = _parse_credentials(request.get_json(silent=True))
        payload = _fetch_payload(credentials)
        if "routines" not in payload:
            payload = _refresh_payload(credentials)
        return jsonify({"routines": list_routines(payload)})

    @app.post("/api/routines/<path:routine_id>/analytics")
    @sleep_and_retry
    @limits(calls=5, period=60)
    def routine_analytics(routine_id: str) -> Any:
        credentials = _parse_credentials(request.get_json(silent=True))
        payload = _fetch_payload(credentials)
        analytics = aggregate_routine_metrics(payload, unquote(routine_id))
        return jsonify(analytics)

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

    @app.errorhandler(RuntimeError)
    def handle_runtime_error(error: RuntimeError) -> Any:
        app.logger.exception("Backend runtime error")
        if str(error).startswith("Hevy is temporarily rate-limiting"):
            return jsonify({"error": str(error)}), 429
        return jsonify({"error": str(error)}), 502

    @app.errorhandler(requests.HTTPError)
    def handle_http_error(error: requests.HTTPError) -> Any:
        app.logger.exception("Hevy HTTP request failed")
        status = error.response.status_code if error.response is not None else 502
        if status == 401:
            return jsonify(
                {"error": "Hevy rejected the authenticated request. Check your API configuration and try again."}
            ), 502
        if status == 502:
            return jsonify({"error": "Hevy login service is temporarily unavailable. Try again shortly."}), 502
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
