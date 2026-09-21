# Hevy Backend API

This backend exposes a Flask API that fetches fresh Hevy data and serves parsed exercise analytics. Workout
fetches page through the complete history in five-workout increments, with a one-second delay between pages
and retry backoff for rate limits and transient server errors.

## Endpoints

- `GET /health`
- `POST /api/auth/login`
- `GET /api/data-status`
- `POST /api/data-refresh`
- `POST /api/exercises`
- `POST /api/exercises/<exercise_name>/graphs/volume_over_time`
- `POST /api/routines`
- `POST /api/routines/analytics`
- `POST /api/routines/<routine_id>/analytics`

## Required environment variables

- `X_API_KEY`
- `RECAPTCHA_SITE_KEY`

Hevy credentials are provided by the frontend request body:

```json
{
  "email_or_username": "your-hevy-login",
  "password": "your-hevy-password"
}
```

## Optional environment variables

- `FRONTEND_ORIGIN` (default: `http://localhost:3000`)
- `HEVY_DATA_FILE` (default: `backend/hevy_data.json`)
- `LOG_LEVEL` (default: `INFO`; set to `DEBUG` for diagnostic request logging)
- `HEVY_VERBOSE_LOGGING` (default: disabled; set to `true` to force diagnostic logging)

## Run

```bash
python hevy_api.py --host 127.0.0.1 --port 5000
```

## Fetch and save all workouts

The standalone fetcher saves the complete parser payload to `hevy_data.json`. Use `--output` to choose
another file.

```bash
python hevy_login.py --output hevy_data.json
```

Refreshes also fetch and cache routine definitions from Hevy's
`GET /v1/routines?page&pageSize` endpoint. Routine analytics are calculated
from cached workouts using total set volume and summed Epley estimated 1RM,
with one comparison point per workout.

Routine synchronization is optional. If Hevy rejects the routines endpoint
with HTTP 401 for a free-account token, login and workout synchronization still
complete and cached routines are preserved.

Every session in the routine analytics carries a comparison with the previous session
(`vs_previous`) and with the average of the previous four (`vs_rolling`). Comparisons are by
primary muscle group: a lift done in both sessions is compared directly on best-set estimated
1RM (best reps for bodyweight lifts); a different lift for the same muscle is compared on best
set for that muscle and marked `swapped`. The headline change is the mean across muscle groups,
so doing fewer sets is not penalised. A comparison is withheld (`insufficient_similarity`) when
fewer than half of the session's muscle groups appear in the baseline. Warm-up sets are ignored.

`POST /api/workouts` lists every workout (including ones outside a routine) and `POST /api/prs`
returns the personal records Hevy flagged on sets, each with its change over the previous record.

## Sign-in and sessions

`POST /api/auth/login` returns a random session token; every other endpoint needs
`Authorization: Bearer <token>`. The browser keeps only the token. Your Hevy password is held
in server memory (needed to refresh data) and, once verified, as a salted scrypt hash in
`backend/.auth.json` (mode 600, git-ignored), so later sign-ins are checked without calling Hevy.
Restarting the backend signs everyone out; sign in again.

If `hevy_data.json` already exists and the identifier matches its account, the first sign-in
is accepted and that password is remembered. Type your real password the first time.

## Tests

```
pip install -r requirements-dev.txt
python -m pytest
```
