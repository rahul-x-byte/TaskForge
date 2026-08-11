# TaskForge Monorepo

TaskForge is a platform for recording, managing, and executing browser automation workflows.

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

## Quick Start (Local Development)

### 1. Infrastructure (Postgres & Redis)

Start database and cache services using Docker Compose:

```bash
docker compose up -d
```

- **Postgres 16**: `localhost:5432` (User: `taskforge`, Pass: `taskforge_password`, DB: `taskforge`)
- **Redis 7**: `localhost:6379`

### 2. Install Dependencies

In each package directory, run `npm install`:

```bash
# Shared types
cd shared && npm install && npm run build && cd ..

# Backend
cd backend && npm install && cd ..

# Worker
cd worker && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..

# Extension
cd extension && npm install && cd ..
```

### 3. Run Development Servers

- **Backend API**:
  ```bash
  cd backend && npm run dev
  ```
  Runs Fastify on `http://localhost:3001` (Health check at `/health`).

- **Worker Service**:
  ```bash
  cd worker && npm run dev
  ```
  Runs the Playwright task execution worker (polls `http://localhost:3001/api/runs/pending`).

- **Frontend App**:
  ```bash
  cd frontend && npm run dev
  ```
  Runs Vite dev server at `http://localhost:5173`.

---

## Production Deployment Architecture

TaskForge is designed for production deployment across **Render** and **Vercel**:

1. **Backend API (Render Web Service)**:
   - Node.js + Fastify REST & WebSocket API (`rootDir: taskforge/backend`).
   - Serves API routes (`/api/*`), WebSocket connections (`/ws/runs/:id`), and uploaded result file downloads (`/api/runs/:id/download`).

2. **Worker Engine (Render Free Web Service with HTTP Health Server)**:
   - Node.js + Playwright Chromium worker process (`rootDir: taskforge/worker`).
   - Runs an embedded HTTP health server listening on `$PORT` to maintain 100% free web service compatibility on Render.
   - Continuously polls `GET /api/runs/pending` and claims jobs via `POST /api/runs/:id/claim`.
   - Automatically uploads downloaded report files to the backend via `POST /api/runs/:id/upload-result`.

3. **Frontend Dashboard (Vercel)**:
   - React 18 + Vite web dashboard hosted on Vercel.
   - Dynamically derives WebSocket URL (`wss://`) from the connected API URL via `getWsBase()`.
   - Features a header **`Backend Connected` ⚙️** pill allowing 1-click backend URL configuration saved in browser `localStorage`.

4. **Chrome Extension Recorder**:
   - Manifest V3 extension with built-in URL auto-normalization (`normalizeRecordingsUrl()`).
   - Allows typing or pasting any backend host into the popup UI, automatically targeting `/api/recordings`.

### Render Blueprint Deployment (`render.yaml`)

Use the included `render.yaml` Blueprint definition:
1. In Render, select **New → Blueprint** and connect your repository.
2. Render provisions:
   - Postgres Database (`taskforge-db`)
   - Redis Key-Value Store (`taskforge-redis`)
   - Backend Web Service (`taskforge-backend`)
   - Worker Web Service (`taskforge-worker`)
3. Set `FRONTEND_URL` on `taskforge-backend` to your Vercel URL (e.g. `https://task-forge-phi-six.vercel.app`).

