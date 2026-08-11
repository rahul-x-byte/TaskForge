# TaskForge — Implementation Tasks Tracker

## Status Key
- `[x]` Completed
- `[ ]` Pending / Future Enhancement

---

## Phase 0 — Monorepo Setup & Infrastructure
- [x] Create monorepo folder structure (`extension/`, `backend/`, `worker/`, `frontend/`, `shared/`).
- [x] Configure `docker-compose.yml` for Postgres 16 & Redis 7 with persistent named volumes.
- [x] Define TypeScript interfaces in `shared/src/types.ts` (`WorkflowStep`, `WorkflowDefinition`, `RunStatus`, `RecordedAction`).
- [x] Create root `package.json` with single-command `npm run dev` (`concurrently`) script.
- [x] Create root `README.md` with setup and execution instructions.

## Phase 1 — Core Playwright Runner
- [x] Build Playwright script (`worker/src/runner.ts` & `worker/src/executor.ts`) with isolated browser contexts.
- [x] Implement multi-strategy selector resolution (`role+name` -> `text` -> `testId` -> `css`).
- [x] Implement automatic target URL navigation when starting from `about:blank`.
- [x] Configure non-headless Chromium browser (`headless: false`) for visual desktop execution.
- [x] Implement error handling with automated screenshot (`worker/failures/*.png`) and Playwright trace (`worker/failures/*.zip`) archiving.

## Phase 2a — Chrome Extension Recorder
- [x] Create Manifest V3 `manifest.json` with `activeTab`, `scripting`, `downloads`, `storage` permissions.
- [x] Build extension popup UI (`extension/src/popup.html` & `popup.ts`) with Start/Stop toggle button.
- [x] Implement content script (`extension/src/content.ts`) to capture `click`, `input`, `change`, `submit`, `blur`, and `history.pushState` navigation events.
- [x] Implement 4-layer selector bundle extraction (ARIA role & accessible name, visible text, testId, CSS fallback).
- [x] Implement automatic password value redaction (`[REDACTED]`).
- [x] Implement background script (`extension/src/background.ts`) to send recorded JSON array to `POST /api/recordings`.
- [x] Implement endpoint URL auto-normalization (`normalizeRecordingsUrl()`) and diagnostic error display in extension popup.

## Phase 2b — Fastify Backend API
- [x] Create Fastify backend server (`backend/src/index.ts`) listening on port 3001.
- [x] Register `@fastify/cors` for cross-origin frontend requests.
- [x] Register `@fastify/formbody` for HTML form URL-encoded POST submissions.
- [x] Implement REST endpoints (`POST /api/recordings`, `GET /api/workflows`, `POST /api/workflows/:id/run`, `GET /api/runs`, `POST /api/workflows/:id/schedule`).
- [x] Implement WebSocket gateway (`/ws/runs/:id`) for live run progress broadcasting.
- [x] Implement Postgres database connection with in-memory fallback engine (`backend/src/db/index.ts`).
- [x] Implement mock test web portal (`/login`, `/reports`, `/download-report`).

## Phase 3 — Integration & Approval Gate
- [x] Connect workflow run queue to trigger worker execution (`worker/src/executor.ts`).
- [x] Implement Human-in-the-Loop sensitive step detection (`isSensitive` / submit actions).
- [x] Implement execution pausing, status update to `awaiting_approval`, and WebSocket prompt broadcasting.
- [x] Implement backend approval endpoints (`POST /api/runs/:id/approve` and `POST /api/runs/:id/cancel`).
- [x] Implement approval polling loop in worker to resume or abort execution.

## Phase 4 — Visual Editor, Live Status UI & Polish
- [x] Build React + Vite app in `frontend/`.
- [x] Create Redesigned Workflow Dashboard (`frontend/src/components/WorkflowDashboard.tsx` & `workflow-dashboard.css`) with template starters (`report-download`, `form-fill`, `page-watch`).
- [x] Implement backend template endpoint (`POST /api/workflows/from-template`) with JSON fixtures stored in `backend/src/templates/`.
- [x] Wire extension recording flow trigger (`handleRecordNew`) and template navigation (`handleUseTemplate`).
- [x] Unify status badge palette (`--tf-mint`, `--tf-amber`, `--tf-danger`) across Audit Log and Dashboard views.
- [x] Create React Flow visual step node graph (`frontend/src/pages/WorkflowDetail.tsx`) highlighting sensitive gates.
- [x] Create Live Run Status Page (`frontend/src/pages/RunStatusPage.tsx`) driven by WebSockets.
- [x] Implement **Approval Gate Modal** with Approve and Cancel buttons.
- [x] Implement Failure View displaying screenshot and trace details.
- [x] Implement Workflow Scheduler modal for setting daily/weekly execution times.
- [x] Implement Audit Log page (`frontend/src/pages/AuditLog.tsx`).
- [x] Implement dark-mode design system (`frontend/src/index.css`).

## Phase 5 — Explicit Sensitivity, Gate Timeouts & Credential Security
- [x] Narrow sensitivity detection to explicit signals (`isSensitive: true` or `action === 'submit'`), removing fragile `css.includes('submit')` heuristic.
- [x] Add step node toggle ("Require approval before this step") in visual workflow editor (`WorkflowDetail.tsx`) persisting via `PUT /api/workflows/:id/steps`.
- [x] Implement 15-minute gate timeout escape hatch in `executor` (`waitForApprovalGate` & `waitForCredentialsGate`) transitioning to `timed_out` state.
- [x] Capture `inputType` in extension `SelectorBundle` (`extension/src/content.ts`).
- [x] Implement Human-in-the-Loop sensitive credential gate (`awaiting_credentials`) for password steps (`[REDACTED]` / `inputType: password`).
- [x] Implement in-memory secret handling (`POST /api/runs/:id/credentials` & `GET /api/runs/:id/credentials`) purging credentials immediately without logging or DB persistence.
- [x] Implement Credential Input Modal in frontend (`RunStatusPage.tsx`) driven by WebSockets (`CREDENTIALS_REQUIRED`).

## Phase 6 — Production Cloud Deployment & Service Bridge Fixes
- [x] Create Render Blueprint definition (`render.yaml`) for database, redis, backend web service, and worker web service.
- [x] Implement Backend-Worker HTTP Polling bridge (`GET /api/runs/pending` & `POST /api/runs/:id/claim`).
- [x] Add embedded HTTP health-check server to worker (`worker/src/index.ts`) for 100% free web service deployment on Render.
- [x] Implement `resolveBackendUrl()` in worker (`worker/src/config.ts`) to validate and auto-normalize missing `https://` schemes.
- [x] Export `getWsBase()` in `frontend/src/api.ts` to derive secure `wss://` WebSocket URLs automatically on Vercel HTTPS pages.
- [x] Add direct click-through from dashboard cards to approval run status pages (`WorkflowDashboard.tsx` & `App.tsx`).
- [x] Implement Worker-to-Backend result file upload transfer (`POST /api/runs/:id/upload-result` & `executor.ts`).
- [x] Add octet-stream binary body parser and upload directory handler in `backend/src/index.ts`.
- [x] Implement dynamic frontend backend URL configuration in `Navbar.tsx` persisted via `localStorage`.

---

## Future Roadmap / Enhancements
- [ ] Drag-and-drop node re-ordering in React Flow graph editor.
- [ ] Multi-browser cross-testing (Firefox & WebKit execution options).
- [ ] Email / Webhook notifications on workflow completion.
