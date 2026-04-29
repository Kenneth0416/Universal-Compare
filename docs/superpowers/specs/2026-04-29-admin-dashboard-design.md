# Admin Dashboard Design

## Goal

Build a private admin dashboard for CompareAI so the owner can see anonymous user count, comparison runs, AI call volume, failures, latency, and popular comparisons.

## Scope

This v1 is for one administrator only. It does not include public user accounts, team roles, billing, exports, alerts, or third-party analytics. All statistics are collected by the existing Express API proxy and stored locally in SQLite.

## Architecture

The existing React/Vite app keeps serving the public comparison experience. The Express server remains the only path to Grok API calls, so it becomes the source of truth for operational metrics. The client generates one `runId` per comparison and sends comparison metadata to the server before the AI pipeline starts. Each `/api/ai` request includes that `runId`; the server records request timing, status, model, call type, visitor id, and errors.

Admin pages live inside the React app at `/admin`. Admin data is served by protected Express routes under `/api/admin/*`. Authentication is a single password from `ADMIN_PASSWORD`, with an HMAC-signed `httpOnly` cookie backed by `ADMIN_SESSION_SECRET`.

## Data Model

`visitors`
- `id`: integer primary key
- `visitor_id`: stable anonymous cookie value
- `first_seen_at`: ISO timestamp
- `last_seen_at`: ISO timestamp
- `user_agent`: request user agent, truncated
- `ip_hash`: SHA-256 hash of the remote IP and session secret

`comparison_runs`
- `id`: integer primary key
- `run_id`: client-generated id for one comparison
- `visitor_id`: anonymous visitor id
- `item_a`: first input
- `item_b`: second input
- `language`: UI language
- `status`: `started`, `completed`, or `failed`
- `error_message`: final run error when available
- `started_at`: ISO timestamp
- `finished_at`: ISO timestamp when completed or failed

`ai_call_logs`
- `id`: integer primary key
- `run_id`: related comparison run id when available
- `visitor_id`: anonymous visitor id
- `call_type`: `responses` or `chat`
- `model`: requested model
- `status`: `success` or `error`
- `status_code`: HTTP status returned to the client
- `duration_ms`: server-side proxy duration
- `error_message`: error text when the call fails
- `created_at`: ISO timestamp

## Server API

Public tracking routes:
- `POST /api/comparison-runs`: starts a comparison run and returns the `runId`.
- `PATCH /api/comparison-runs/:runId`: marks a run as `completed` or `failed`.
- `POST /api/ai`: existing proxy route, extended to log every AI call.

Admin routes:
- `POST /api/admin/login`: validates `ADMIN_PASSWORD` and sets the admin cookie.
- `POST /api/admin/logout`: clears the admin cookie.
- `GET /api/admin/session`: returns whether the current request is authenticated.
- `GET /api/admin/summary`: returns dashboard metrics for today and the last 7 days.
- `GET /api/admin/runs`: returns recent comparison runs with call counts.
- `GET /api/admin/calls`: returns recent AI call logs.
- `GET /api/admin/users`: returns anonymous visitor activity.

All admin routes except login reject unauthenticated requests with `401`.

## Frontend

The public comparison form creates a `runId` through `POST /api/comparison-runs` before calling `generateComparison`. The generated `runId` is passed through the AI service to every `callAI` request. The run is marked `completed` after a report is assembled and `failed` when the pipeline throws.

The admin UI uses the same visual language as the current app, but with a denser operational layout:
- login screen at `/admin` when unauthenticated
- dashboard metric cards
- 7-day user and call trend charts
- recent comparison runs table
- recent failed AI calls table
- popular comparisons table
- secondary tabs for all runs, calls, and anonymous users

## Error Handling

Tracking failures must not block the public comparison experience. If starting or finishing a comparison run fails on the client, the comparison continues and the console receives a short warning. AI proxy logging failures are handled server-side and must not hide the original AI response or original AI error.

Admin API errors are shown inline in the admin UI. Login failures show a generic invalid password message.

## Security

The admin password is never exposed to the client except through login submission. Admin sessions are stored in signed `httpOnly`, `sameSite=lax` cookies. The server hashes IP addresses before storing them. No raw prompt payloads, AI response bodies, or API keys are persisted in the analytics tables.

## Testing

Server tests cover database initialization, visitor cookies, comparison run lifecycle, AI call logging, admin authentication, and admin summary aggregation. Client verification covers TypeScript compilation and production build. Manual smoke testing should open `/admin`, log in, run one comparison, and confirm the dashboard updates.
