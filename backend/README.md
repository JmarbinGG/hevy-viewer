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
