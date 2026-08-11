# TaskForge Monorepo

TaskForge is a modern platform for recording, managing, and executing browser automation workflows.

## Directory Structure

```
taskforge/
├── docker-compose.yml   # Postgres 16 (port 5432) + Redis 7 (port 6379)
├── extension/           # Chrome Manifest V3 + TypeScript recorder extension
├── backend/             # Node.js + Fastify + TypeScript backend API
├── worker/              # Node.js + TypeScript + Playwright workflow runner
├── frontend/            # React + Vite + TypeScript web interface
└── shared/              # Shared TypeScript types and interfaces
```

## Production Deployment Architecture

TaskForge is designed for multi-service cloud deployment across **Render** and **Vercel**:

1. **Backend API (Render Web Service)**:
   - Node.js + Fastify REST & WebSocket API (`rootDir: taskforge/backend`).
   - Handles REST routes (`/api/*`), WebSocket channels (`/ws/runs/:id`), and report file uploads/downloads (`/api/runs/:id/download`).

2. **Worker Engine (Render Free Web Service with HTTP Health Server)**:
   - Node.js + Playwright Chromium runner (`rootDir: taskforge/worker`).
   - Runs an embedded HTTP health server listening on `$PORT` to support Render's 100% free web service tier.
   - Continuously polls `GET /api/runs/pending` and claims jobs via `POST /api/runs/:id/claim`.
   - Automatically uploads downloaded report files to the backend via `POST /api/runs/:id/upload-result`.

3. **Frontend Dashboard (Vercel)**:
   - React 18 + Vite dashboard hosted on Vercel.
   - Automatically resolves secure `wss://` WebSockets via `getWsBase()`.
   - Includes a **`Backend Connected` ⚙️** header pill allowing 1-click backend URL updates saved in browser `localStorage`.

4. **Chrome Extension Recorder**:
   - Manifest V3 extension with URL auto-normalization (`normalizeRecordingsUrl()`).
   - Targets `/api/recordings` automatically and displays diagnostic feedback in the popup.

### Deploying via Render Blueprint (`render.yaml`)

The repository includes a ready-to-use `render.yaml` Blueprint definition at the repo root:
1. In Render, select **New → Blueprint** and select your repository.
2. Render provisions:
   - Postgres Database (`taskforge-db`)
   - Redis Instance (`taskforge-redis`)
   - Backend Web Service (`taskforge-backend`)
   - Worker Web Service (`taskforge-worker`)
3. Set `FRONTEND_URL` on `taskforge-backend` to your Vercel URL (e.g. `https://task-forge-phi-six.vercel.app`).
