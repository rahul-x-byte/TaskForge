# TaskForge — Product Requirements Document (PRD)

## 1. Executive Summary
TaskForge is a modern, resilient browser automation and workflow orchestration platform. It enables non-technical and technical users alike to record browser actions via a Chrome Manifest V3 extension, translate those recordings into Playwright automation scripts with robust selector strategies, manage and edit workflows in a visual node editor, execute tasks with Human-in-the-Loop approval gates for sensitive actions, and track execution history in real-time.

---

## 2. Product Goals & Core Objectives
- **Resilient Element Selector Matching**: Fall back seamlessly across ARIA roles, visible text content, `data-testid` attributes, and CSS selectors so browser updates don't break automated workflows.
- **Human-in-the-Loop Security**: Automatically detect sensitive actions (e.g. login form submits, payment steps, data deletions) and pause execution for human sign-off via real-time WebSocket prompts.
- **Visual Workflow Editing**: Render recorded steps as an interactive node graph using React Flow for visualization, scheduling, and management.
- **Reliable Execution Engine**: Run Playwright in isolated browser contexts with automated screenshot and trace diagnostic captures on failures.
- **Zero-Friction Local Development**: Support full execution via in-memory fallbacks when Postgres/Redis are offline, while providing Docker Compose setup for production deployment.

---

## 3. Key Feature Specifications

### 3.1 Chrome Manifest V3 Extension (`extension/`)
- **Action Recording**: Listens for `click`, `input`, `change`, `form submit`, and `history.pushState` navigation events.
- **Selector Bundling**: Captures 5-layer selector strategy for every interaction:
  1. Stable videoId / link ID (for dynamic content sites like YouTube)
  2. ARIA role & accessible name (exact match)
  3. Visible text snippet (exact match)
  4. `data-testid` attribute
  5. CSS fallback selector
- **Password Redaction**: Automatically sanitizes sensitive input fields (masked as `[REDACTED]`).
- **One-Click Sync**: Posts recorded step arrays directly to `POST /api/recordings`.

### 3.2 Backend API & WebSocket Engine (`backend/`)
- **REST Endpoints**:
  - `POST /api/recordings`: Save recorded step sequences as workflow definitions.
  - `POST /api/workflows/from-template`: Create pre-populated workflows from starter JSON fixtures (`report-download`, `form-fill`, `page-watch`).
  - `GET /api/workflows`: List stored workflows with step counts, schedules, and last run status (`success` | `failed` | `awaiting_approval` | `never_run`).
  - `GET /api/workflows/:id`: Retrieve full workflow definition and step array.
  - `POST /api/workflows/:id/run`: Enqueue workflow execution and launch worker.
  - `POST /api/workflows/:id/schedule`: Configure daily/weekly execution schedules.
  - `GET /api/runs`: Fetch recent execution history for the Audit Log.
  - `GET /api/runs/:id`: Get detailed run status and step execution logs.
  - `PATCH /api/runs/:id/status`: Internal worker status update endpoint.
  - `POST /api/runs/:id/approve`: Approve pending sensitive step gate.
  - `POST /api/runs/:id/cancel`: Abort active run execution.
- **WebSocket Gateway (`/ws/runs/:id`)**: Broadcasts real-time step execution status, approval gate triggers, and completion notifications to connected frontend clients.

### 3.3 Playwright Execution Worker (`worker/`)
- **Isolated Browser Context**: Spawns isolated Chromium instances (`headless: false`) per run.
- **Selector Resolution Order**: Tries `videoId` $\rightarrow$ `exact role+name` $\rightarrow$ `exact visible text` $\rightarrow$ `data-testid` $\rightarrow$ `CSS selector`.
- **Automatic Navigation**: Detects target domain and auto-navigates if starting from `about:blank`.
- **Sensitive Gate Pausing**: Pauses execution at tagged sensitive steps, updates database status to `awaiting_approval`, and polls for resolution.
- **Diagnostic Capture**: Saves full-page PNG screenshots to `worker/failures/*.png` and Playwright trace archives to `worker/failures/*.zip` on failure.

### 3.4 Frontend React Web UI (`frontend/`)
- **Workflow Dashboard**: Card grid listing workflows, step counts, and quick run triggers.
- **React Flow Graph**: Visual node editor rendering step flows with red security badges for approval gates.
- **Live Status Timeline**: Real-time vertical timeline driven by WebSockets.
- **Approval Gate Modal**: Pop-up modal prompting users to **Approve & Resume** or **Abort Execution** for sensitive steps.
- **Audit Log**: Execution history table with status badges and timestamp logs.
- **Workflow Scheduler**: Time picker modal for setting repeatable daily/weekly cron runs.
