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
import os
import time
from datetime import date
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from playwright.async_api import async_playwright


HEVY_BASE_URL = "https://api.hevyapp.com"
HEVY_LOGIN_URL = "https://www.hevy.com/login"
WORKOUT_PAGE_SIZE = 5
DEFAULT_PAGE_DELAY_SECONDS = 1.0
MAX_WORKOUT_REQUEST_RETRIES = 4
DEFAULT_DATA_FILE = Path(__file__).with_name("hevy_data.json")


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


async def get_recaptcha_token(site_key: str) -> str:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page()
        page.set_default_timeout(15000)
        await page.goto(HEVY_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)

        token = await page.evaluate(
            """
            async (siteKey) => {
              for (let i = 0; i < 50; i++) {
                if (typeof window.recaptchaToken === "string" && window.recaptchaToken.length > 0) {
                  return window.recaptchaToken;
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
        return token


def hevy_login(email_or_username: str, password: str, recaptcha_token: str, x_api_key: str) -> dict[str, Any]:
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
    print("logging in")
    response = requests.post(f"{HEVY_BASE_URL}/login", headers=headers, json=body, timeout=30)
    response.raise_for_status()
    data = response.json()
    if not data.get("access_token"):
        raise RuntimeError("Login succeeded but access_token is missing")
    return data


def fetch_account(access_token: str, x_api_key: str) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "x-api-key": x_api_key,
        "Content-Type": "application/json",
    }
    response = requests.get(f"{HEVY_BASE_URL}/user/account", headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_workouts(
    access_token: str,
    x_api_key: str,
    username: str,
    offset: int = 0,
    page_delay: float = DEFAULT_PAGE_DELAY_SECONDS,
    stop_at_ids: set[str] | None = None,
) -> dict[str, Any]:
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
            response = requests.get(
                f"{HEVY_BASE_URL}/user_workouts_paged",
                headers=headers,
                params={"username": username, "offset": current_offset},
                timeout=30,
            )
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


def load_payload(output_path: str | os.PathLike[str] = DEFAULT_DATA_FILE) -> dict[str, Any] | None:
    path = Path(output_path)
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Saved Hevy data must be a JSON object")
    workouts = payload.get("workouts", [])
    if not isinstance(workouts, list):
        raise ValueError("Saved Hevy data did not include a workouts list")
    payload["workouts"] = [sanitize_workout(item) for item in workouts]
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
) -> dict[str, Any]:
    """Fetch only workouts newer than the newest cached workout when possible."""
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
    )
    fetched = page.get("workouts", [])
    new_workouts = [
        workout for workout in fetched
        if not isinstance(workout, dict) or str(workout.get("id")) not in known_ids
    ]
    cached_workouts = (existing or {}).get("workouts", [])
    if not isinstance(cached_workouts, list):
        cached_workouts = []
    payload = {
        "user_id": user_id if user_id is not None else (existing or {}).get("user_id"),
        "username": username,
        "email": account.get("email"),
        "account": account,
        "workouts": new_workouts + cached_workouts,
        "last_offset": page.get("last_offset", (existing or {}).get("last_offset", 0)),
        "last_updated": date.today().isoformat(),
    }
    save_payload(payload, output_path)
    return payload


def save_payload(payload: dict[str, Any], output_path: str | os.PathLike[str]) -> None:
    """Write the complete fetch payload in the format consumed by the parser."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


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
    load_dotenv()
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

    result = {
        "user_id": login_data.get("user_id"),
        "username": username,
        "email": account.get("email"),
        "offset": args.offset,
        "last_offset": workouts.get("last_offset", args.offset),
        "last_updated": date.today().isoformat(),
        "account": account,
        "workouts": workouts.get("workouts", []),
    }
    save_payload(result, args.output)

    if args.compact:
        print(json.dumps(result))
    else:
        print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
