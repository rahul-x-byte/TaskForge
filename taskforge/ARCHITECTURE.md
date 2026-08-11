# TaskForge — System Architecture Document

## 1. System Architecture Overview

```
[ Chrome Extension ] ──(REST POST /api/recordings)──┐
                                                    │
[ Frontend React UI ] ──(REST / WS /ws/runs/:id)───┼──> [ Fastify Backend API ]
                                                    │             ▲
[ Workflow Scheduler ] ─────────────────────────────┘             │ (Job Claim POST /api/runs/:id/claim)
                                                                  │ (File Upload POST /api/runs/:id/upload-result)
                                                        [ Playwright Worker ]
                                                                  │
                                                        (Automates Web Apps)
                                                                  │
                                                        [ Failure Diagnostics ]
                                                        (PNG Screenshots / ZIP Traces)
```

---

## 2. Component Specifications

### 2.1 Shared Data Layer (`shared/`)
- Contains TypeScript contracts used across `extension`, `backend`, `worker`, and `frontend`.
- Key definitions ([shared/src/types.ts](file:///d:/EXTENSION/taskforge/shared/src/types.ts)):
  - `SelectorBundle`: `{ role?, name?, text?, testId?, css?, videoId?, inputType? }`
  - `RecordedAction`: `{ action, timestamp, selectors, value?, pageUrl?, isSensitive? }`
  - `WorkflowDefinition`: `{ id, name, created_at, steps }`
  - `RunStatus`: `'pending' | 'running' | 'awaiting_approval' | 'awaiting_credentials' | 'completed' | 'failed' | 'cancelled' | 'timed_out'`

### 2.2 Backend Service ([backend/src/index.ts](file:///d:/EXTENSION/taskforge/backend/src/index.ts))
- **Framework**: Fastify + Fastify CORS + Fastify Formbody + Fastify WebSockets + Octet-Stream Binary Parser.
- **Data Store**: Postgres 16 database with an automatic in-memory fallback layer ([backend/src/db/index.ts](file:///d:/EXTENSION/taskforge/backend/src/db/index.ts)).
- **Backend-Worker Bridge**: Serves `GET /api/runs/pending` and atomic `POST /api/runs/:id/claim` endpoints.
- **File Upload Gateway**: Serves `POST /api/runs/:id/upload-result` to receive downloaded report binary buffers from workers, saving them to backend `uploads/` disk storage.
- **Template System**: Pre-populated starter workflow skeletons loaded from JSON fixtures in `backend/src/templates/` via `POST /api/workflows/from-template`, backed by in-memory fallback step definitions.
- **WebSocket Gateway**: Maintains socket maps per `runId` and pushes JSON events (`STATUS_UPDATE`, `APPROVAL_GRANTED`, `RUN_CANCELLED`, `CREDENTIALS_REQUIRED`, `CREDENTIALS_SUBMITTED`).

### 2.3 Worker Engine ([worker/src/executor.ts](file:///d:/EXTENSION/taskforge/worker/src/executor.ts))
- **Execution Engine**: Node.js + Playwright Chromium.
- **Embedded Health Check**: Includes an embedded HTTP server listening on `$PORT` to allow 100% free web service deployment on Render.
- **URL Normalization**: `resolveBackendUrl()` validates and normalizes `BACKEND_URL` on boot, auto-prefixing missing `https://` schemes.
- **Polling Loop**: Continuously queries `GET /api/runs/pending` and claims jobs via `POST /api/runs/:id/claim`.
- **Selector Engine**: Resolves locator strategies asynchronously with `.count()`:
  1. `page.locator('a[href*="videoId"]')`
  2. `page.getByRole(role, { name, exact: true })`
  3. `page.getByText(text, { exact: true })`
  4. `page.getByTestId(testId)`
  5. `page.locator(css)`
- **Gate Handler**: When encountering `isSensitive === true` or explicit `submit` actions, updates status to `awaiting_approval` and polls `GET /api/runs/:id` for up to 15 minutes.
- **File Upload Sync**: Automatically reads downloaded files (`fs/promises.readFile`) and uploads them to the backend via `POST /api/runs/:id/upload-result`.

### 2.4 Frontend Web Application ([frontend/src/App.tsx](file:///d:/EXTENSION/taskforge/frontend/src/App.tsx))
- **Stack**: React 18 + Vite + TypeScript + Lucide React + @xyflow/react.
- **WebSocket Resolution**: `getWsBase()` automatically derives secure `wss://` protocol from `API_BASE` on HTTPS Vercel deployments.
- **Dynamic Backend Configurator**: Features a header badge `Backend Connected ⚙️` allowing 1-click backend URL configuration persisted in `localStorage.getItem('taskforge_api_base')`.
- **Dashboard Click-Through**: "Awaiting approval" badges link directly to `/runs/:latestRunId` status pages.

---

## 3. Data Schema & Contracts

### 3.1 Database Schema (Postgres & Memory Fallback)
```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  current_version_id UUID
);

CREATE TABLE workflow_versions (
  id UUID PRIMARY KEY,
  workflow_id UUID REFERENCES workflows(id),
  steps JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE runs (
  id UUID PRIMARY KEY,
  workflow_id UUID REFERENCES workflows(id),
  version_id UUID REFERENCES workflow_versions(id),
  status VARCHAR(50) NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP
);
```

---

## 4. Security & Compliance Controls
- **Password Masking & In-Memory Gate**: Extension replaces password input values with `[REDACTED]`. During run execution, password inputs pause the run (`awaiting_credentials`), prompting the user in the UI. Secrets are held strictly in memory and purged immediately after fill without being written to DB, logs, or disk.
- **Human Approval Gates**: Explicitly tagged sensitive actions freeze Playwright execution until explicitly authorized via UI (or timed out after 15 minutes).
- **Trace & Diagnostic Archiving**: Sensitive failure traces are saved to local filesystem (`worker/failures/`) and excluded from public version control.
