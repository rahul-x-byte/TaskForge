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

## Quick Start

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
  Runs the Playwright task execution worker.

- **Frontend App**:
  ```bash
  cd frontend && npm run dev
  ```
  Runs Vite dev server at `http://localhost:5173`.
