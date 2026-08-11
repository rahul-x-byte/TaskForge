# TaskForge — Architecture Decision Records (ADRs)

## ADR-001: Multi-Strategy Selector Fallback Sequence
- **Status**: Approved & Implemented
- **Context**: Automated web tests break frequently when web developers update element class names or internal DOM structures, or when substring matching matches multiple dynamic search results.
- **Decision**: For every recorded action, capture a bundle of 5 selector strategies evaluated asynchronously with `.count()`:
  1. Stable ID / Video ID (`page.locator('a[href*="videoId"]')`)
  2. ARIA role & accessible name exact match (`page.getByRole(role, { name, exact: true })`)
  3. Visible text content exact match (`page.getByText(text, { exact: true })`)
  4. `data-testid` attribute (`page.getByTestId(testId)`)
  5. CSS fallback selector (`page.locator(css)`)
- **Consequences**: Prevents strict-mode violations on dynamic sites like YouTube and eliminates false-positive substring selector matches.

---

## ADR-002: Human-in-the-Loop Approval Gates
- **Status**: Approved & Implemented
- **Context**: Automated workflows executing sensitive operations (form submissions, payments, deletions) present operational risks if executed unmonitored.
- **Decision**: Detect steps tagged as `isSensitive` or submit actions. When reached, pause Playwright execution, set run status to `awaiting_approval`, push a WebSocket notification to the frontend, and poll `GET /api/runs/:id` until a human user clicks **Approve** or **Cancel** in the UI.
- **Consequences**: Guarantees safety for high-stakes browser automation flows.

---

## ADR-003: In-Memory Database & Queue Fallback Engine
- **Status**: Approved & Implemented
- **Context**: Setting up local Postgres & Redis Docker containers can be a friction point during development.
- **Decision**: Implement an in-memory SQL compatibility layer ([backend/src/db/index.ts](file:///d:/EXTENSION/taskforge/backend/src/db/index.ts)) and in-memory queue fallback ([backend/src/queue/index.ts](file:///d:/EXTENSION/taskforge/backend/src/queue/index.ts)). When Postgres or Redis are unreachable, TaskForge automatically seamlessly falls back to in-memory operation.
- **Consequences**: Zero setup friction for local development while preserving full Docker production deployment options.

---

## ADR-004: Non-Headless Playwright Visual Execution
- **Status**: Approved & Implemented
- **Context**: Users running automated workflows locally want visual feedback on what the browser automation worker is doing.
- **Decision**: Configure Playwright Chromium launcher with `{ headless: false }`.
- **Consequences**: A visible browser window opens on the desktop screen during workflow execution, enabling live visual monitoring.

---

## ADR-005: `@fastify/cors` & `@fastify/formbody` Plugin Registration
- **Status**: Approved & Implemented
- **Context**: Browser security blocks cross-origin requests from the frontend (`http://localhost:5173`) to the backend (`http://localhost:3001`), and HTML form posts return `415 Unsupported Media Type` without form parsers.
- **Decision**: Register `@fastify/cors` with `{ origin: true }` and `@fastify/formbody` globally in Fastify.
- **Consequences**: Resolves CORS pre-flight blocks and supports URL-encoded form submissions.

---

## ADR-006: Redesigned Workflow Dashboard & Starter Template System
- **Status**: Approved & Implemented
- **Context**: New users encountering an empty dashboard had no clear immediate path to test browser automation capabilities without recording from scratch or running seed scripts manually.
- **Decision**: Introduce `WorkflowDashboard.tsx` featuring connected starter template cards (`report-download`, `form-fill`, `page-watch`), a backend route `POST /api/workflows/from-template` backed by JSON fixtures under `backend/src/templates/`, an extension recording trigger (`onRecordNew`), and unified status badge colors (`--tf-mint`, `--tf-amber`, `--tf-danger`).
- **Consequences**: Enables 1-click workflow creation with pre-filled step skeletons while preserving visual consistency across Audit Logs and Dashboard views.

---

## ADR-007: Explicit Step Sensitivity & In-Memory Credential Gate
- **Status**: Approved & Implemented
- **Context**: Silent selector string matching (like `css.includes('submit')`) caused false-positive pauses on benign clicks (e.g. video playback buttons). Meanwhile, password fields auto-substituting `TEST_PASSWORD` from env vars reduced flexibility and posed security risks.
- **Decision**: 
  1. Restrict sensitive step detection to explicit signals (`step.isSensitive === true` explicitly set by user, or `step.action === 'submit'`).
  2. Add a visual toggle on step nodes ("Require approval before this step") in `WorkflowDetail.tsx` persisting via `PUT /api/workflows/:id/steps`.
  3. Add a 15-minute timeout to approval & credential gates, transitioning unhandled runs to `timed_out`.
  4. Prompt users via frontend modal when a run encounters password inputs (`awaiting_credentials`). Store credential values strictly in-memory during run duration via `POST /api/runs/:id/credentials` and `GET /api/runs/:id/credentials`, purging secrets immediately after fill without logging or database persistence.
- **Consequences**: Eliminates false positive workflow pauses while ensuring zero secret leakage to logs or database storage.

---

## ADR-008: Persistent Render Worker & HTTP Polling Job Bridge
- **Status**: Approved & Implemented
- **Context**: Render background worker service types require paid plans. To run 100% free on Render while remaining continuously active polling for workflow runs, workers must handle HTTP health checks.
- **Decision**: Add an embedded HTTP server listening on `$PORT` inside `worker/src/index.ts`. Deploy `taskforge-worker` as a `type: web` service on Render's `free` plan, polling `GET /api/runs/pending` and claiming execution jobs via `POST /api/runs/:id/claim`.
- **Consequences**: Achieves continuous background execution on Render's 100% free tier.

---

## ADR-009: Vercel-Render Dynamic WebSocket Resolution via `getWsBase()`
- **Status**: Approved & Implemented
- **Context**: Hardcoded `ws://localhost:3001` URLs fail on HTTPS Vercel deployments due to browser mixed-content security policies blocking unencrypted WebSockets.
- **Decision**: Export `getWsBase()` in `frontend/src/api.ts` which derives the WebSocket URL directly from the active `API_BASE` (`http` $\rightarrow$ `ws`, `https` $\rightarrow$ `wss`).
- **Consequences**: Ensures secure `wss://` protocol connections on Vercel production deployments without requiring manual env var tweaks.

---

## ADR-010: Worker-to-Backend Result File Upload Transfer
- **Status**: Approved & Implemented
- **Context**: Worker and backend run on separate Render cloud instances with separate file storage, causing `404 Report file not found` errors when users attempt to download files from the web dashboard.
- **Decision**: Add `uploadResultFileToBackend()` in `worker/src/executor.ts` that streams downloaded file buffers to `POST /api/runs/:id/upload-result` on the backend, which stores files in backend `uploads/` disk storage.
- **Consequences**: Enables seamless report file downloads and previews from the web dashboard across separate cloud instances.

---

## ADR-011: Chrome Extension URL Auto-Normalization & Diagnostics
- **Status**: Approved & Implemented
- **Context**: Users typing base server URLs (e.g. `https://taskforge-backend-xxxx.onrender.com`) into the extension popup encountered 404 errors when posting recordings.
- **Decision**: Add `normalizeRecordingsUrl()` in `extension/src/background.ts` to automatically format endpoints to target `/api/recordings`, and detect `x-render-routing: no-server` response headers to return clear diagnostic messages.
- **Consequences**: Prevents user setup errors and provides instant feedback in the Chrome Extension popup.

---

## ADR-012: Dynamic Frontend Backend URL Configurator
- **Status**: Approved & Implemented
- **Context**: Hardcoded production backend fallbacks break whenever a user deletes and recreates a Render Blueprint with a new URL.
- **Decision**: Add an interactive **Backend Connected ⚙️** pill in `Navbar.tsx` allowing 1-click URL configuration saved in browser `localStorage` under `taskforge_api_base`.
- **Consequences**: Users can switch or update backend API URLs directly on the live Vercel dashboard without rebuilding or re-deploying code.
