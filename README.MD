# Hevy Viewer

Hevy Viewer is a local web application for exploring exercise history from a
Hevy account. It fetches and caches workout data in the backend, parses
per-set records, and displays exercise progress charts in a Next.js frontend.

## Features

- Fetches the complete workout history using offset-based pagination.
- Uses paced requests and retry backoff for rate limits and transient errors.
- Stores the normalized data in one JSON file for repeatable analysis.
- Removes heart-rate data and non-English exercise title fields before saving.
- Refreshes incrementally by checking the newest workouts first.
- Lists exercises by workout frequency, then set count.
- Provides modular progress graphs:
  - Volume over time
  - Maximum set weight over time
  - Estimated 1RM over time using the Epley formula:
    `1RM = weight × (1 + reps / 30)`

## Project structure

```text
backend/
  hevy_api.py          Flask API
  hevy_login.py        Hevy login, pagination, caching, and sanitization
  hevy_data_parser.py  Workout parsing and analytics
  hevy_data.json       Local cached workout payload
frontend/hevy-viewer/
  app/                 Next.js application
  package.json         Frontend scripts and dependencies
```

## Requirements

- Python 3.11 or newer
- Node.js 20 or newer
- A Hevy account
- Hevy API credentials:
  - `X_API_KEY`
  - `RECAPTCHA_SITE_KEY`

The API key and reCAPTCHA key are server-side configuration. Do not commit
them or expose them through `NEXT_PUBLIC_*` variables.

## Configuration

Create `backend/.env`:

```env
X_API_KEY=your-hevy-api-key
RECAPTCHA_SITE_KEY=your-recaptcha-site-key
```

Optional backend settings:

```env
FRONTEND_ORIGIN=http://localhost:3000
HEVY_DATA_FILE=backend/hevy_data.json
```

Optional frontend setting:

```env
NEXT_PUBLIC_HEVY_API_URL=http://127.0.0.1:5000
```

## Installation

Install backend dependencies:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # macOS/Linux
pip install -r requirements.txt
playwright install chromium
```

Install frontend dependencies:

```bash
cd frontend/hevy-viewer
npm install
```

## Running locally

Start the backend from `backend/`:

```bash
python hevy_api.py --host 127.0.0.1 --port 5000
```

Start the frontend in a second terminal:

```bash
cd frontend/hevy-viewer
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in, and open the
Exercises page.

## Data and refresh behavior

The backend stores the cache at `backend/hevy_data.json` by default. The file
contains the account metadata, normalized workouts, `last_updated`, and
`last_offset`.

When the cache is missing or was not updated today, the Exercises page shows
an inline refresh prompt. Refreshing fetches the newest pages first, adds
workouts not already present, stops at the first known workout, and updates the
cache. Requests are serialized with a delay between pages to reduce rate-limit
risk.

To fetch and save data without the web UI:

```bash
cd backend
python hevy_login.py --output hevy_data.json
```

Useful options:

```text
--offset N       Start at a specific item offset
--page-delay N   Delay between pages in seconds (default: 1)
--output PATH    Output JSON path (default: hevy_data.json)
--compact        Print compact JSON to stdout
```

The saved payload is the input shape expected by
`hevy_data_parser.parse_hevy_login_data`.

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/api/data-status` | Check cache freshness |
| POST | `/api/auth/login` | Validate credentials and return user info |
| POST | `/api/data-refresh` | Fetch and merge new workouts |
| POST | `/api/exercises` | Return parsed exercise summaries |
| POST | `/api/exercises/<exercise>/graphs/<graph>` | Return graph points |

Graph names currently include `volume_over_time`, `max_over_time`, and
`one_rep_max` (also accepted as `one_rep_max_over_time`).

## Frontend commands

Run these from `frontend/hevy-viewer/`:

```bash
npm run dev    # Development server
npm run lint   # ESLint
npm run build  # Production build
npm start      # Serve the production build
```

## Privacy and security

This project handles Hevy credentials and workout history locally. The
credentials are cached in the browser's local storage for the current app
flow, while the workout cache is stored on the backend filesystem. Keep
`backend/.env` and `backend/hevy_data.json` private.

The project is an independent viewer and is not affiliated with Hevy.