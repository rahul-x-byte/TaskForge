# TaskForge — System Architecture Document

## 1. System Architecture Overview

```
[ Chrome Extension ] ──(REST POST /api/recordings)──┐
                                                    │
[ Frontend React UI ] ──(REST / WS /ws/runs/:id)───┼──> [ Fastify Backend API ]
                                                    │             │
[ Workflow Scheduler ] ─────────────────────────────┘             │ (Job Queue / Trigger)
                                                                  ▼
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
26:   - `SelectorBundle`: `{ role?, name?, text?, testId?, css?, videoId?, inputType? }`
27:   - `RecordedAction`: `{ action, timestamp, selectors, value?, pageUrl?, isSensitive? }`
28:   - `WorkflowDefinition`: `{ id, name, created_at, steps }`
29:   - `RunStatus`: `'pending' | 'running' | 'awaiting_approval' | 'awaiting_credentials' | 'completed' | 'failed' | 'cancelled' | 'timed_out'`
30: 
31: ### 2.2 Backend Service ([backend/src/index.ts](file:///d:/EXTENSION/taskforge/backend/src/index.ts))
32: - **Framework**: Fastify + Fastify CORS + Fastify Formbody + Fastify WebSockets.
33: - **Data Store**: Postgres 16 database with an automatic in-memory fallback layer ([backend/src/db/index.ts](file:///d:/EXTENSION/taskforge/backend/src/db/index.ts)).
34: - **Template System**: Pre-populated starter workflow skeletons loaded from JSON fixtures in `backend/src/templates/` via `POST /api/workflows/from-template`.
35: - **Queue System**: BullMQ over Redis 7 with memory queue fallback ([backend/src/queue/index.ts](file:///d:/EXTENSION/taskforge/backend/src/queue/index.ts)).
36: - **WebSocket Gateway**: Maintains socket maps per `runId` and pushes JSON events (`STATUS_UPDATE`, `APPROVAL_GRANTED`, `RUN_CANCELLED`, `CREDENTIALS_REQUIRED`, `CREDENTIALS_SUBMITTED`).
37: - **In-Memory Credential Store**: Temporarily holds runtime user credentials in memory via `POST /api/runs/:id/credentials` and `GET /api/runs/:id/credentials`, purging secrets immediately upon worker retrieval.
38: 
39: ### 2.3 Worker Engine ([worker/src/executor.ts](file:///d:/EXTENSION/taskforge/worker/src/executor.ts))
40: - **Execution Engine**: Node.js + Playwright Chromium.
41: - **Selector Engine**: Resolves locator strategies asynchronously with `.count()`:
42:   1. `page.locator('a[href*="videoId"]')`
43:   2. `page.getByRole(role, { name, exact: true })`
44:   3. `page.getByText(text, { exact: true })`
45:   4. `page.getByTestId(testId)`
46:   5. `page.locator(css)`
47: - **Gate Handler**: When encountering `isSensitive === true` or explicit `submit` actions, updates status to `awaiting_approval` and polls `GET /api/runs/:id` for up to 15 minutes before timing out to `timed_out`.
48: - **Credential Gate**: When encountering `[REDACTED]` or password inputs, transitions status to `awaiting_credentials` and polls `GET /api/runs/:id/credentials` for up to 15 minutes before timing out to `timed_out`.
49: 
50: ### 2.4 Frontend Web Application ([frontend/src/App.tsx](file:///d:/EXTENSION/taskforge/frontend/src/App.tsx))
51: - **Stack**: React 18 + Vite + TypeScript + Lucide React + @xyflow/react.
52: - **State Management**: Local state with WebSocket listeners for live run status.
53: - **Design System**: Vanilla CSS dark-mode design system ([frontend/src/index.css](file:///d:/EXTENSION/taskforge/frontend/src/index.css)) with glassmorphism panels, connected template cards ([frontend/src/components/WorkflowDashboard.tsx](file:///d:/EXTENSION/taskforge/frontend/src/components/WorkflowDashboard.tsx)), step node sensitivity toggles, and a unified status badge palette (`--tf-mint`, `--tf-amber`, `--tf-danger`).
54: 
55: ---
56: 
57: ## 3. Data Schema & Contracts
58: 
59: ### 3.1 Database Schema (Postgres & Memory Fallback)
60: ```sql
61: CREATE TABLE workflows (
62:   id UUID PRIMARY KEY,
63:   name VARCHAR(255) NOT NULL,
64:   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
65:   current_version_id UUID
66: );
67: 
68: CREATE TABLE workflow_versions (
69:   id UUID PRIMARY KEY,
70:   workflow_id UUID REFERENCES workflows(id),
71:   steps JSONB NOT NULL,
72:   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
73: );
74: 
75: CREATE TABLE runs (
76:   id UUID PRIMARY KEY,
77:   workflow_id UUID REFERENCES workflows(id),
78:   version_id UUID REFERENCES workflow_versions(id),
79:   status VARCHAR(50) NOT NULL,
80:   started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
81:   finished_at TIMESTAMP
82: );
83: ```
84: 
85: ---
86: 
87: ## 4. Security & Compliance Controls
88: - **Password Masking & In-Memory Gate**: Extension replaces password input values with `[REDACTED]`. During run execution, password inputs pause the run (`awaiting_credentials`), prompting the user in the UI. Secrets are held strictly in memory and purged immediately after fill without being written to DB, logs, or disk.
89: - **Human Approval Gates**: Explicitly tagged sensitive actions freeze Playwright execution until explicitly authorized via UI (or timed out after 15 minutes).
90: - **Trace & Diagnostic Archiving**: Sensitive failure traces are saved to local filesystem (`worker/failures/`) and excluded from public version control.
