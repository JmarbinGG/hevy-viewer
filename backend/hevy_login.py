"""
Standalone Hevy free-data fetcher (independent from project modules).

What it does:
1) Uses Playwright to generate a reCAPTCHA token from hevy.com/login
2) Logs in to Hevy with email/username + password
3) Fetches /user/account
4) Fetches and stores the complete workout history from /user_workouts_paged

Required environment variables:
- X_API_KEY
- RECAPTCHA_SITE_KEY

Optional environment variables:
- HEVY_EMAIL_OR_USERNAME
- HEVY_PASSWORD
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import logging
import os
import re
import time
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from playwright.async_api import async_playwright


HEVY_BASE_URL = "https://api.hevyapp.com"
HEVY_LOGIN_URL = "https://www.hevy.com/login"
WORKOUT_PAGE_SIZE = 5
ROUTINE_PAGE_SIZE = 10
DEFAULT_PAGE_DELAY_SECONDS = 1.0
MAX_WORKOUT_REQUEST_RETRIES = 4
DEFAULT_DATA_FILE = Path(__file__).with_name("hevy_data.json")
logger = logging.getLogger(__name__)


def configure_logging() -> None:
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    if os.getenv("HEVY_VERBOSE_LOGGING", "").lower() in {"1", "true", "yes", "on"}:
        level_name = "DEBUG"
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )
    logger.setLevel(level)


def _safe_preview(value: str, limit: int = 500) -> str:
    redacted = re.sub(
        r"(?i)(access_token|auth_token|refresh_token|password|recaptchaToken|x-api-key|authorization)"
        r'(["\']?\s*[:=]\s*["\']?)[^,"\'}\s]+',
        r"\1<redacted>",
        value,
    )
    return redacted[:limit]


def _log_response(
    method: str,
    url: str,
    response: requests.Response,
    started_at: float,
) -> None:
    logger.debug(
        "%s %s -> %s in %.0fms (cookies=%d, content_length=%s)",
        method,
        url,
        response.status_code,
        (time.perf_counter() - started_at) * 1000,
        len(response.cookies),
        response.headers.get("Content-Length", "unknown"),
    )
    if response.status_code >= 400:
        logger.debug("Hevy error response preview: %s", _safe_preview(response.text))


def _response_preview(response: requests.Response) -> str:
    text = response.text.strip()
    return _safe_preview(text, limit=200) if text else ""


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


async def get_recaptcha_token(site_key: str) -> str:
    logger.debug("Starting reCAPTCHA browser flow (site key configured=%s)", bool(site_key))
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = await browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        )
        page.set_default_timeout(15000)
        await page.goto(HEVY_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
        logger.debug("Loaded reCAPTCHA page: %s", page.url)
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            await page.wait_for_timeout(2000)

        token = await page.evaluate(
            """
            async (siteKey) => {
              for (let i = 0; i < 50; i++) {
                const token = window.recaptchaToken || window.__recaptchaToken;
                if (typeof token === "string" && token.length > 0) {
                  return token;
                }
                await new Promise((resolve) => setTimeout(resolve, 200));
              }
              if (window.grecaptcha?.enterprise?.execute) {
                return await window.grecaptcha.enterprise.execute(siteKey, { action: "login" });
              }
              throw new Error("reCAPTCHA token not available on page");
            }
            """,
            site_key,
        )

        await browser.close()
        if not token or not isinstance(token, str):
            raise RuntimeError("Failed to obtain reCAPTCHA token")
        logger.debug("Generated reCAPTCHA token (length=%d)", len(token))
        return token


def hevy_login(
    email_or_username: str,
    password: str,
    recaptcha_token: str,
    x_api_key: str,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    http = session or requests.Session()
    headers = {
        "x-api-key": x_api_key,
        "Content-Type": "application/json",
        "Hevy-Platform": "web",
    }
    body = {
        "emailOrUsername": email_or_username,
        "password": password,
        "recaptchaToken": recaptcha_token,
        "useAuth2_0": True,
    }
    logger.info("Submitting Hevy login request for identifier %s", email_or_username)
    logger.debug("Login request fields: %s", sorted(body.keys()))
    login_url = f"{HEVY_BASE_URL}/login"
    started_at = time.perf_counter()
    response = http.post(login_url, headers=headers, json=body, timeout=30)
    _log_response("POST", login_url, response, started_at)
    try:
        response.raise_for_status()
    except requests.HTTPError as error:
        preview = _response_preview(response)
        detail = f" Hevy returned: {preview!r}" if preview else ""
        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            retry_detail = f" Retry after {retry_after} seconds." if retry_after else ""
            raise RuntimeError(
                "Hevy is temporarily rate-limiting login attempts."
                f"{retry_detail} Wait before trying again; your credentials were not verified or rejected."
                f"{detail}"
            ) from error
        raise RuntimeError(
            f"Hevy rejected the login request (HTTP {response.status_code})."
            " This can indicate an expired reCAPTCHA token, invalid API configuration,"
            f" or rejected credentials.{detail}"
        ) from error
    try:
        data = response.json()
    except requests.exceptions.JSONDecodeError as error:
        response_preview = response.text.strip()[:200]
        detail = f" Hevy returned: {response_preview!r}" if response_preview else ""
        raise RuntimeError(
            f"Hevy login returned an invalid response (HTTP {response.status_code}).{detail}"
        ) from error
    if not isinstance(data, dict):
        raise RuntimeError("Login returned an invalid response object")
    logger.debug("Login response fields: %s", sorted(data.keys()))
    access_token = data.get("access_token") or data.get("auth_token")
    if not access_token:
        raise RuntimeError("Login succeeded but access_token is missing")
    data["access_token"] = access_token
    return data


def fetch_account(
    access_token: str,
    x_api_key: str,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    http = session or requests.Session()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "x-api-key": x_api_key,
        "Content-Type": "application/json",
    }
    account_url = f"{HEVY_BASE_URL}/user/account"
    started_at = time.perf_counter()
    response = http.get(account_url, headers=headers, timeout=30)
    _log_response("GET", account_url, response, started_at)
    try:
        response.raise_for_status()
    except requests.HTTPError as error:
        preview = _response_preview(response)
        detail = f" Hevy returned: {preview!r}" if preview else ""
        raise RuntimeError(
            f"Hevy account request was rejected (HTTP {response.status_code}).{detail}"
        ) from error
    try:
        account = response.json()
    except requests.exceptions.JSONDecodeError as error:
        preview = _response_preview(response)
        detail = f" Hevy returned: {preview!r}" if preview else ""
        raise RuntimeError(
            f"Hevy account request returned an invalid response (HTTP {response.status_code}).{detail}"
        ) from error
    if not isinstance(account, dict):
        raise RuntimeError("Hevy account response was not a JSON object")
    logger.debug("Account response fields: %s", sorted(account.keys()))
    return account


def fetch_workouts(
    access_token: str,
    x_api_key: str,
    username: str,
    offset: int = 0,
    page_delay: float = DEFAULT_PAGE_DELAY_SECONDS,
    stop_at_ids: set[str] | None = None,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    http = session or requests.Session()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "x-api-key": x_api_key,
        "Content-Type": "application/json",
    }
    if offset < 0:
        raise ValueError("offset must be >= 0")
    if page_delay < 0:
        raise ValueError("page_delay must be >= 0")

    workouts: list[Any] = []
    seen_workout_ids: set[str] = set()
    first_response: dict[str, Any] = {}
    current_offset = offset

    while True:
        if workouts:
            time.sleep(page_delay)
        print(f"fetching workouts (offset {current_offset})")
        for attempt in range(MAX_WORKOUT_REQUEST_RETRIES + 1):
            workouts_url = f"{HEVY_BASE_URL}/user_workouts_paged"
            started_at = time.perf_counter()
            response = http.get(
                workouts_url,
                headers=headers,
                params={"username": username, "offset": current_offset},
                timeout=30,
            )
            _log_response("GET", workouts_url, response, started_at)
            if response.status_code not in {429, 500, 502, 503, 504} or attempt == MAX_WORKOUT_REQUEST_RETRIES:
                response.raise_for_status()
                break

            retry_after = response.headers.get("Retry-After")
            try:
                wait_seconds = float(retry_after) if retry_after is not None else 2**attempt
            except ValueError:
                wait_seconds = 2**attempt
            time.sleep(max(wait_seconds, 0))

        page = response.json()
        if not isinstance(page, dict):
            raise ValueError("Hevy response was not a JSON object")
        page_workouts = page.get("workouts", [])
        logger.debug(
            "Workout page offset=%d returned %d workouts",
            current_offset,
            len(page_workouts) if isinstance(page_workouts, list) else -1,
        )
        if not isinstance(page_workouts, list):
            raise ValueError("Hevy response did not include a workouts list")
        if not first_response:
            first_response = page
        if not page_workouts:
            break

        for workout in page_workouts:
            workout = sanitize_workout(workout)
            workout_id = workout.get("id") if isinstance(workout, dict) else None
            if workout_id is not None:
                normalized_id = str(workout_id)
                if stop_at_ids and normalized_id in stop_at_ids:
                    page_workouts = []
                    break
                if normalized_id in seen_workout_ids:
                    continue
                seen_workout_ids.add(normalized_id)
            workouts.append(workout)

        if len(page_workouts) < WORKOUT_PAGE_SIZE:
            break
        current_offset += WORKOUT_PAGE_SIZE

    first_response["workouts"] = workouts
    first_response["last_offset"] = current_offset
    return first_response


def fetch_routines(
    access_token: str,
    x_api_key: str,
    page: int = 1,
    page_size: int = ROUTINE_PAGE_SIZE,
    page_delay: float = DEFAULT_PAGE_DELAY_SECONDS,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Fetch all routine pages from the verified v1 routines endpoint."""
    if page < 1:
        raise ValueError("page must be >= 1")
    if page_size < 1:
        raise ValueError("page_size must be >= 1")
    if page_delay < 0:
        raise ValueError("page_delay must be >= 0")

    http = session or requests.Session()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "x-api-key": x_api_key,
        "Content-Type": "application/json",
    }
    routines: list[Any] = []
    first_response: dict[str, Any] = {}
    current_page = page

    while True:
        if routines:
            time.sleep(page_delay)
        routines_url = f"{HEVY_BASE_URL}/v1/routines"
        started_at = time.perf_counter()
        response = http.get(
            routines_url,
            headers=headers,
            params={"page": current_page, "pageSize": page_size},
            timeout=30,
        )
        _log_response("GET", routines_url, response, started_at)
        response.raise_for_status()
        page_data = response.json()
        if not isinstance(page_data, dict):
            raise ValueError("Hevy routines response was not a JSON object")
        page_routines = page_data.get("routines", [])
        logger.debug(
            "Routine page=%d returned %d routines",
            current_page,
            len(page_routines) if isinstance(page_routines, list) else -1,
        )
        if not isinstance(page_routines, list):
            raise ValueError("Hevy routines response did not include a routines list")
        if not first_response:
            first_response = page_data
        routines.extend(sanitize_workout(item) for item in page_routines)

        page_count = page_data.get("page_count")
        if not page_routines or (
            isinstance(page_count, int) and current_page >= page_count
        ):
            break
        if len(page_routines) < page_size and not isinstance(page_count, int):
            break
        current_page += 1

    first_response["routines"] = routines
    first_response["page"] = page
    if "page_count" not in first_response:
        first_response["page_count"] = current_page
    return first_response


def sanitize_workout(value: Any) -> Any:
    """Remove biometric data and non-English localized exercise fields."""
    if isinstance(value, list):
        return [sanitize_workout(item) for item in value]
    if not isinstance(value, dict):
        return value

    sanitized: dict[str, Any] = {}
    for key, item in value.items():
        key_lower = key.lower()
        if "heart_rate" in key_lower or "heartrate" in key_lower:
            continue
        if key_lower.endswith("_title") and key_lower not in {"exercise_title"}:
            language = key_lower.removesuffix("_title")
            if language not in {"en", "english"}:
                continue
        sanitized[key] = sanitize_workout(item)
    return sanitized


def _derive_routines_from_workouts(workouts: list[Any]) -> list[dict[str, Any]]:
    routines: dict[str, dict[str, Any]] = {}
    for workout in workouts:
        if not isinstance(workout, dict):
            continue
        routine_id = str(workout.get("routine_id") or "")
        if not routine_id:
            continue

        routine = routines.setdefault(
            routine_id,
            {
                "id": routine_id,
                "name": workout.get("name") or workout.get("title") or "Untitled Routine",
                "exercises": [],
            },
        )
        existing_exercises = {
            str(exercise.get("id") or exercise.get("title") or "")
            for exercise in routine["exercises"]
            if isinstance(exercise, dict)
        }
        exercises = workout.get("exercises")
        if not isinstance(exercises, list):
            continue
        for exercise in exercises:
            if not isinstance(exercise, dict):
                continue
            exercise_key = str(exercise.get("id") or exercise.get("title") or "")
            if exercise_key and exercise_key not in existing_exercises:
                routine["exercises"].append(
                    {
                        "id": exercise.get("id"),
                        "title": exercise.get("title"),
                        "exercise_template_id": exercise.get("exercise_template_id"),
                    }
                )
                existing_exercises.add(exercise_key)

    return sorted(routines.values(), key=lambda routine: str(routine["name"]).lower())


def load_payload(output_path: str | os.PathLike[str] = DEFAULT_DATA_FILE) -> dict[str, Any] | None:
    path = Path(output_path)
    if not path.exists():
        return None
    serialized_payload = path.read_text(encoding="utf-8")
    if not serialized_payload.strip():
        return None
    payload = json.loads(serialized_payload)
    if not isinstance(payload, dict):
        raise ValueError("Saved Hevy data must be a JSON object")
    workouts = payload.get("workouts", [])
    if not isinstance(workouts, list):
        raise ValueError("Saved Hevy data did not include a workouts list")
    payload["workouts"] = [sanitize_workout(item) for item in workouts]
    routines = payload.get("routines")
    if routines is not None:
        if not isinstance(routines, list):
            raise ValueError("Saved Hevy data did not include a routines list")
        payload["routines"] = [sanitize_workout(item) for item in routines]
    if not payload.get("routines"):
        payload["routines"] = _derive_routines_from_workouts(payload["workouts"])
    sanitized_json = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if path.read_text(encoding="utf-8") != sanitized_json:
        path.write_text(sanitized_json, encoding="utf-8")
    return payload


def refresh_payload(
    access_token: str,
    x_api_key: str,
    username: str,
    account: dict[str, Any],
    user_id: Any = None,
    output_path: str | os.PathLike[str] = DEFAULT_DATA_FILE,
    page_delay: float = DEFAULT_PAGE_DELAY_SECONDS,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Fetch workouts and routines, merging new data into the local cache."""
    existing = load_payload(output_path)
    known_ids = {
        str(workout["id"])
        for workout in (existing or {}).get("workouts", [])
        if isinstance(workout, dict) and workout.get("id") is not None
    }
    page = fetch_workouts(
        access_token,
        x_api_key,
        username=username,
        offset=0,
        page_delay=page_delay,
        stop_at_ids=known_ids or None,
        session=session,
    )
    fetched = page.get("workouts", [])
    new_workouts = [
        workout for workout in fetched
        if not isinstance(workout, dict) or str(workout.get("id")) not in known_ids
    ]
    cached_workouts = (existing or {}).get("workouts", [])
    if not isinstance(cached_workouts, list):
        cached_workouts = []
    try:
        routine_page = fetch_routines(
            access_token,
            x_api_key,
            page=1,
            page_size=ROUTINE_PAGE_SIZE,
            page_delay=page_delay,
            session=session,
        )
        fetched_routines = routine_page.get("routines", [])
        routine_page_count = routine_page.get("page_count", 1)
    except requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else None
        if status != 401:
            raise
        logger.warning(
            "Skipping routine sync because Hevy rejected the routines endpoint "
            "for this account/token (HTTP 401)"
        )
        fetched_routines = (existing or {}).get("routines", [])
        routine_page_count = (existing or {}).get("routines_page_count", 1)
    if not isinstance(fetched_routines, list):
        fetched_routines = []
    if not isinstance(routine_page_count, int):
        routine_page_count = 1
    payload = {
        "user_id": user_id if user_id is not None else (existing or {}).get("user_id"),
        "username": username,
        "email": account.get("email"),
        "account": account,
        "workouts": new_workouts + cached_workouts,
        "routines": fetched_routines,
        "routines_page_count": routine_page_count,
        "last_offset": page.get("last_offset", (existing or {}).get("last_offset", 0)),
        "last_updated": date.today().isoformat(),
    }
    save_payload(payload, output_path)
    return payload


def save_payload(payload: dict[str, Any], output_path: str | os.PathLike[str]) -> None:
    """Write the complete fetch payload in the format consumed by the parser."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_file.write(serialized)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
            temporary_path = Path(temporary_file.name)
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch free Hevy data using email/password + Playwright")
    parser.add_argument("--email", dest="email_or_username", default=os.getenv("HEVY_EMAIL_OR_USERNAME"))
    parser.add_argument("--password", default=os.getenv("HEVY_PASSWORD"))
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--page-delay", type=float, default=DEFAULT_PAGE_DELAY_SECONDS)
    parser.add_argument("--output", default="hevy_data.json", help="Path for the complete parser input JSON")
    parser.add_argument("--compact", action="store_true", help="Print compact JSON instead of pretty-formatted JSON")
    return parser.parse_args()


def main() -> None:
    load_dotenv(Path(__file__).with_name(".env"))
    configure_logging()
    args = parse_args()
    x_api_key = require_env("X_API_KEY")
    recaptcha_site_key = require_env("RECAPTCHA_SITE_KEY")

    email_or_username = args.email_or_username or input("Hevy email/username: ").strip()
    password = args.password or getpass.getpass("Hevy password: ")
    if args.offset < 0:
        raise RuntimeError("offset must be >= 0")
    if args.page_delay < 0:
        raise RuntimeError("page-delay must be >= 0")

    recaptcha_token = asyncio.run(get_recaptcha_token(recaptcha_site_key))
    login_data = hevy_login(email_or_username, password, recaptcha_token, x_api_key)
    access_token = login_data["access_token"]

    account = fetch_account(access_token, x_api_key)
    username = account.get("username")
    if not username:
        raise RuntimeError("Account response does not include username")

    workouts = fetch_workouts(access_token, x_api_key, username=username, offset=args.offset)
    routines = fetch_routines(access_token, x_api_key)

    result = {
        "user_id": login_data.get("user_id"),
        "username": username,
        "email": account.get("email"),
        "offset": args.offset,
        "last_offset": workouts.get("last_offset", args.offset),
        "last_updated": date.today().isoformat(),
        "account": account,
        "workouts": workouts.get("workouts", []),
        "routines": routines.get("routines", []),
        "routines_page_count": routines.get("page_count", 1),
    }
    save_payload(result, args.output)

    if args.compact:
        print(json.dumps(result))
    else:
        print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
