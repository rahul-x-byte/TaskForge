# TaskForge — Agent Instructions & Operational Rules

## Workspace Operational Rules

1. **Maintain Documentation Integrity**:
   - Whenever a feature, endpoint, data schema, or selector strategy is updated, update [PRD.md](file:///d:/EXTENSION/taskforge/PRD.md), [ARCHITECTURE.md](file:///d:/EXTENSION/taskforge/ARCHITECTURE.md), [TASKS.md](file:///d:/EXTENSION/taskforge/TASKS.md), and [DECISIONS.md](file:///d:/EXTENSION/taskforge/DECISIONS.md).

2. **Single-Command Launch Verification**:
   - Ensure `npm run dev` in the root `taskforge` directory always starts all 3 core services (`backend`, `frontend`, `worker`) cleanly with `concurrently`.

3. **Selector Strategy Order**:
   - Always enforce the 5-layer selector resolution order: `videoId` -> `exact role+name` -> `exact text` -> `testId` -> `cssFallback`.

4. **Security & Redaction**:
   - Never log or store raw passwords in recordings or database JSON files. Ensure password fields are sanitized with `[REDACTED]`.

5. **Build & Type Checking Verification**:
   - After making changes to any package (`shared`, `backend`, `worker`, `frontend`, `extension`), run `npm run build` in that package to ensure 0 TypeScript compilation errors before declaring success.
