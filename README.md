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

## Production Deployment Architecture

TaskForge requires **THREE separate services** to function in production:

1. **Backend API (Render Web Service)**:
   - Public REST & WebSocket API server.
   - Deployed as a Node.js **Web Service** (`rootDir: taskforge/backend`).

2. **Worker Engine (Render Background Worker)**:
   - Continuous Node.js + Playwright worker process that polls `GET /api/runs/pending` and claims execution jobs via `POST /api/runs/:id/claim`.
   - Must be deployed on Render as a **Background Worker** service type (NOT a Web Service) so it stays alive indefinitely with no HTTP port.
   - Build script installs Playwright Chromium with system dependencies: `npx playwright install --with-deps chromium`.

3. **Frontend App (Vercel)**:
   - React + Vite dashboard UI hosted on Vercel.
   - Configure `VITE_API_BASE` environment variable in Vercel to point to your Render backend API (`https://taskforge-backend.onrender.com/api`).

> **Critical**: Workflows will remain stuck at `PENDING` if the worker service is not running continuously as a separate process.

### Deploying via Render Blueprint (`render.yaml`)

The repository includes a ready-to-use `render.yaml` Blueprint definition at the repo root:
1. In Render, select **New → Blueprint** and select your repository.
2. Render will automatically read `render.yaml` and provision:
   - Postgres Database (`taskforge-db`)
   - Redis Instance (`taskforge-redis`)
   - Backend Web Service (`taskforge-backend`)
   - Worker Background Service (`taskforge-worker`)
3. Set `FRONTEND_URL` on `taskforge-backend` to your Vercel URL (e.g. `https://task-forge-phi-six.vercel.app`).
