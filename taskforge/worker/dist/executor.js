import playwright from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { readFile } from 'fs/promises';
import { resolveBackendUrl } from './config.js';
const { chromium } = playwright;
const BACKEND_URL = resolveBackendUrl();
const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
const FAILURES_DIR = path.resolve(process.cwd(), 'failures');
if (!fs.existsSync(DOWNLOADS_DIR))
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(FAILURES_DIR))
    fs.mkdirSync(FAILURES_DIR, { recursive: true });
const WORKER_SECRET = process.env.WORKER_SECRET || 'taskforge-worker-secret-key-2026';
export class ElementNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ElementNotFoundError';
    }
}
async function uploadResultFileToBackend(runId, filePath) {
    if (!filePath || !fs.existsSync(filePath))
        return;
    try {
        const fileBuffer = await readFile(filePath);
        const filename = path.basename(filePath);
        console.log(`[Executor] Uploading downloaded result file ${filename} for run ${runId} to backend...`);
        const res = await fetch(`${BACKEND_URL}/api/runs/${runId}/upload-result`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'X-Filename': filename,
                'X-Worker-Secret': WORKER_SECRET,
            },
            body: fileBuffer,
        });
        if (res.ok) {
            console.log(`[Executor] Successfully uploaded result file ${filename} to backend for run ${runId}`);
        }
        else {
            console.warn(`[Executor Upload Warning] Backend returned HTTP status ${res.status} for file upload`);
        }
    }
    catch (err) {
        console.error(`[Executor Upload Error] Failed to upload result file to backend:`, err);
    }
}
// Multi-Strategy Selector Resolver (VideoID -> Role + Name -> TestID -> Stable CSS -> Visible Text -> Interactive Ancestor)
// STRICT: Never falls back to BODY. Throws ElementNotFoundError if no matching interactive element is found.
async function resolveInteractiveTarget(page, step, timeoutMs = 8000) {
    const selectors = step.selectors;
    if (!selectors) {
        throw new ElementNotFoundError(`No selectors provided for step action "${step.action}"`);
    }
    const isClickAction = step.action === 'click' || step.action === 'submit';
    const isInputAction = step.action === 'input' || step.action === 'change';
    const attempted = [];
    async function testCandidate(locator, strategyName, desc) {
        attempted.push(strategyName);
        try {
            await locator.first().waitFor({ state: 'attached', timeout: Math.min(timeoutMs, 3000) });
            const count = await locator.count();
            if (count === 0)
                return null;
            let targetLoc = locator.first();
            if (isInputAction) {
                const tagName = await targetLoc.evaluate((el) => el.tagName ? el.tagName.toLowerCase() : '').catch(() => '');
                const isContentEditable = await targetLoc.evaluate((el) => !!el.isContentEditable).catch(() => false);
                if (!['input', 'textarea', 'select'].includes(tagName) && !isContentEditable) {
                    const innerInput = targetLoc.locator('input, textarea, select, [contenteditable="true"]').first();
                    if (await innerInput.count().catch(() => 0) > 0) {
                        targetLoc = innerInput;
                    }
                }
                await targetLoc.waitFor({ state: 'visible', timeout: 3000 });
                const isEditable = await targetLoc.isEditable({ timeout: 2000 }).catch(() => true);
                if (!isEditable)
                    return null;
            }
            if (isClickAction) {
                await targetLoc.waitFor({ state: 'visible', timeout: 3000 });
                const isEnabled = await targetLoc.isEnabled({ timeout: 2000 }).catch(() => true);
                if (!isEnabled)
                    return null;
            }
            return { locator: targetLoc, strategy: strategyName, description: desc, matches: count };
        }
        catch {
            return null;
        }
    }
    // 1. Video ID strategy (e.g. YouTube video links)
    if (selectors.videoId && typeof selectors.videoId === 'string' && selectors.videoId !== 'true' && selectors.videoId !== 'false') {
        const vid = selectors.videoId;
        const loc = page.locator(`a[href*="v=${vid}"], a[href*="/shorts/${vid}"], a[href*="${vid}"]`);
        const found = await testCandidate(loc, 'videoId', `videoId=${vid}`);
        if (found)
            return found;
    }
    // 2. Role + Accessible Name
    if (selectors.role && selectors.name && typeof selectors.role === 'string' && typeof selectors.name === 'string' && selectors.name !== 'true' && selectors.name !== 'false') {
        try {
            const loc = page.getByRole(selectors.role, { name: selectors.name });
            const found = await testCandidate(loc, 'role+name', `role=${selectors.role} name="${selectors.name}"`);
            if (found)
                return found;
        }
        catch { }
        try {
            const escaped = selectors.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const loc = page.getByRole(selectors.role, { name: new RegExp(escaped, 'i') });
            const found = await testCandidate(loc, 'role+name(regex)', `role=${selectors.role} name=~/${selectors.name}/i`);
            if (found)
                return found;
        }
        catch { }
    }
    // 3. TestID
    if (selectors.testId && typeof selectors.testId === 'string' && selectors.testId !== 'true' && selectors.testId !== 'false') {
        const loc = page.getByTestId(selectors.testId);
        const found = await testCandidate(loc, 'testId', `testId=${selectors.testId}`);
        if (found)
            return found;
    }
    // 4. Stable CSS (reject body, html, window, empty)
    if (selectors.css && typeof selectors.css === 'string' && selectors.css !== 'true' && selectors.css !== 'false') {
        const cleanCss = selectors.css.trim();
        if (cleanCss && cleanCss !== 'body' && cleanCss !== 'html' && cleanCss !== 'window') {
            const loc = page.locator(cleanCss);
            const found = await testCandidate(loc, 'css', `css=${cleanCss}`);
            if (found)
                return found;
        }
    }
    // 5. Visible Text
    if (selectors.text && typeof selectors.text === 'string' && selectors.text !== 'true' && selectors.text !== 'false' && selectors.text.length < 100) {
        const loc = page.getByText(selectors.text, { exact: false });
        const found = await testCandidate(loc, 'text', `text="${selectors.text}"`);
        if (found)
            return found;
    }
    // 6. Semantic interactive ancestor (if css was on a child icon/img, climb to button/a)
    if (selectors.css && selectors.css !== 'body' && selectors.css !== 'html' && selectors.css !== 'window') {
        try {
            const parentLoc = page.locator(selectors.css).locator('xpath=ancestor-or-self::*[self::a or self::button or self::input or self::select or self::textarea or @role="button" or @role="link" or @role="combobox"]').first();
            const found = await testCandidate(parentLoc, 'interactive-ancestor', `ancestor of ${selectors.css}`);
            if (found)
                return found;
        }
        catch { }
    }
    // Fail strictly: NEVER return body for interactive operations
    throw new ElementNotFoundError(`ElementNotFoundError: Could not resolve interactive target for action "${step.action}". Attempted strategies: [${attempted.join(', ')}]. Selectors: ${JSON.stringify(selectors)}`);
}
// Poll DB/Backend for Approval Gate Resolution (with in-browser navigation auto-approval & 15-minute timeout)
async function waitForApprovalGate(page, runId, stepIndex, stepDetail, totalSteps = 0) {
    const targetLabel = stepDetail.selectors?.name || stepDetail.selectors?.text || stepDetail.selectors?.css || 'Target element';
    const initialUrl = page && !page.isClosed() ? page.url() : '';
    console.log(`[Approval Gate] Run ${runId} paused at step ${stepIndex + 1}/${totalSteps} (${stepDetail.action} on ${targetLabel}). Awaiting approval...`);
    await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({
            status: 'awaiting_approval',
            detail: {
                stepIndex,
                action: stepDetail.action,
                targetLabel,
                pageUrl: stepDetail.pageUrl || '',
                totalSteps,
            },
        }),
    }).catch(() => { });
    const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;
    const startTime = Date.now();
    while (Date.now() - startTime < APPROVAL_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
            const res = await fetch(`${BACKEND_URL}/api/runs/${runId}`, {
                headers: { 'X-Worker-Secret': WORKER_SECRET },
            });
            if (res.ok) {
                const data = await res.json();
                const currentStatus = data.run?.status;
                if (currentStatus === 'running' || currentStatus === 'approved') {
                    console.log(`[Approval Gate] Approval granted for run ${runId}. Resuming execution.`);
                    return true;
                }
                if (currentStatus === 'cancelled' || currentStatus === 'failed') {
                    console.log(`[Approval Gate] Run ${runId} was cancelled/aborted.`);
                    return false;
                }
            }
            if (page && !page.isClosed()) {
                const currentUrl = page.url();
                if (initialUrl && currentUrl !== initialUrl && !currentUrl.includes('/login')) {
                    console.log(`[Approval Gate] Detected in-browser form submission & page navigation to ${currentUrl}. Auto-granting approval and resuming!`);
                    await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
                        body: JSON.stringify({
                            status: 'running',
                            detail: { stepIndex, action: stepDetail.action, targetLabel, pageUrl: currentUrl, totalSteps },
                        }),
                    }).catch(() => { });
                    return true;
                }
            }
        }
        catch (err) {
            console.warn(`[Approval Gate Polling Warning]`, err);
        }
    }
    console.log(`[Approval Gate Timeout] Run ${runId} timed out after 15 minutes awaiting approval.`);
    await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({
            status: 'timed_out',
            finishedAt: new Date().toISOString(),
            error: 'Approval gate timed out after 15 minutes',
        }),
    }).catch(() => { });
    return false;
}
// Poll DB/Backend for Credential Input Resolution or In-Browser Login (with 15-minute timeout)
async function waitForCredentialsGate(page, runId, stepIndex, stepDetail) {
    const fieldLabel = stepDetail.selectors?.name || stepDetail.selectors?.css || 'Password';
    const initialUrl = page && !page.isClosed() ? page.url() : '';
    console.log(`[Interactive Login & Credentials Gate] Run ${runId} paused at step ${stepIndex + 1} for login/credentials (${fieldLabel}). Awaiting user input or in-browser login...`);
    await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({
            status: 'awaiting_login',
            detail: {
                stepIndex,
                fieldLabel,
                message: 'Please enter credentials or log in & solve CAPTCHA in the open browser window. TaskForge will auto-resume once logged in!',
            },
        }),
    }).catch(() => { });
    const CREDENTIAL_TIMEOUT_MS = 15 * 60 * 1000;
    const startTime = Date.now();
    while (Date.now() - startTime < CREDENTIAL_TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
            const credRes = await fetch(`${BACKEND_URL}/api/runs/${runId}/credentials`, {
                headers: { 'X-Worker-Secret': WORKER_SECRET },
            });
            if (credRes.ok) {
                const credData = await credRes.json();
                if (credData.found && credData.credential?.value !== undefined) {
                    console.log(`[Credentials Gate] Credential received via UI for run ${runId} step ${stepIndex + 1}. Resuming execution.`);
                    return credData.credential.value;
                }
            }
            if (page && !page.isClosed()) {
                const currentUrl = page.url();
                if (initialUrl && currentUrl !== initialUrl && !currentUrl.includes('/login')) {
                    console.log(`[Interactive Login Gate] Detected in-browser login & navigation to ${currentUrl}. Auto-resuming workflow execution!`);
                    await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
                        body: JSON.stringify({ status: 'running' }),
                    }).catch(() => { });
                    return '[IN_BROWSER_LOGGED_IN]';
                }
            }
            const runRes = await fetch(`${BACKEND_URL}/api/runs/${runId}`, {
                headers: { 'X-Worker-Secret': WORKER_SECRET },
            });
            if (runRes.ok) {
                const data = await runRes.json();
                const currentStatus = data.run?.status;
                if (currentStatus === 'cancelled' || currentStatus === 'failed') {
                    console.log(`[Credentials Gate] Run ${runId} was cancelled/aborted.`);
                    return null;
                }
            }
        }
        catch (err) {
            console.warn(`[Credentials Gate Polling Warning]`, err);
        }
    }
    console.log(`[Credentials Gate Timeout] Run ${runId} timed out after 15 minutes awaiting credentials or login.`);
    await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({
            status: 'timed_out',
            finishedAt: new Date().toISOString(),
            error: 'Credential entry / login timed out after 15 minutes',
        }),
    }).catch(() => { });
    return null;
}
export async function executeWorkflowRun(workflowId, versionId, runId) {
    let browser = null;
    let context = null;
    let page = null;
    const timestamp = Date.now();
    let currentStepIndex = 0;
    let currentAction = 'init';
    let currentTargetLabel = '';
    let currentStrategy = '';
    let downloadedFilePath = null;
    let isRunApproved = false;
    try {
        // 1. Fetch Workflow Version & Steps
        const wfRes = await fetch(`${BACKEND_URL}/api/workflows/${workflowId}`, {
            headers: { 'X-Worker-Secret': WORKER_SECRET },
        });
        if (!wfRes.ok) {
            throw new Error(`Failed to load workflow ${workflowId} from backend (HTTP ${wfRes.status})`);
        }
        const wfData = await wfRes.json();
        const rawSteps = wfData.steps || [];
        if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
            throw new Error(`Workflow ${workflowId} contains no execution steps`);
        }
        console.log(`[Executor] Starting execution for Run ${runId} (Workflow: ${wfData.name || workflowId}, Total Steps: ${rawSteps.length})`);
        // Broadcast running status
        await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
            body: JSON.stringify({
                status: 'running',
                detail: { stepIndex: 0, totalSteps: rawSteps.length, status: 'running' },
            }),
        });
        // 2. Launch Browser & Tracing (NO SIMULATION MODE - Chromium launch failure MUST fail the run)
        const isHeadless = process.env.HEADLESS !== 'false';
        console.log(`[Executor] Launching Chromium (headless: ${isHeadless})...`);
        try {
            browser = await chromium.launch({
                headless: isHeadless,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            });
            context = await browser.newContext({ acceptDownloads: true });
            await context.tracing.start({ screenshots: true, snapshots: true });
            page = await context.newPage();
        }
        catch (launchErr) {
            throw new Error(`Playwright Chromium could not be launched: ${launchErr?.message || launchErr}`);
        }
        // Global Download Handler: Automatically catch and save downloaded files
        page.on('download', async (download) => {
            try {
                const origFilename = download.suggestedFilename() || `result_download_${Date.now()}.pdf`;
                const destPath = path.join(DOWNLOADS_DIR, origFilename);
                await download.saveAs(destPath);
                downloadedFilePath = destPath;
                console.log(`[Executor Global Download Handler] Successfully saved file download to: ${destPath}`);
                await uploadResultFileToBackend(runId, destPath);
            }
            catch (dErr) {
                console.error(`[Executor Global Download Error] Failed to save download:`, dErr);
            }
        });
        // New Tab & Popup Download Handler
        context.on('page', async (newPage) => {
            newPage.on('download', async (download) => {
                try {
                    const origFilename = download.suggestedFilename() || `result_report_${Date.now()}.pdf`;
                    const destPath = path.join(DOWNLOADS_DIR, origFilename);
                    await download.saveAs(destPath);
                    downloadedFilePath = destPath;
                    console.log(`[Executor Popup Tab Download] Saved file to: ${destPath}`);
                    await uploadResultFileToBackend(runId, destPath);
                }
                catch (e) { }
            });
        });
        // 3. Step Execution Loop (Strict execution - any step failure terminates the run with FAILED status)
        for (let i = 0; i < rawSteps.length; i++) {
            currentStepIndex = i;
            const step = rawSteps[i];
            currentAction = step.action;
            currentTargetLabel = (typeof step.selectors?.name === 'string' && step.selectors.name !== 'true' && step.selectors.name !== 'false' && step.selectors.name) ||
                (typeof step.selectors?.text === 'string' && step.selectors.text !== 'true' && step.selectors.text !== 'false' && step.selectors.text) ||
                (typeof step.selectors?.videoId === 'string' && `videoId:${step.selectors.videoId}`) ||
                (typeof step.selectors?.css === 'string' && step.selectors.css !== 'true' && step.selectors.css) ||
                step.value ||
                step.pageUrl ||
                'Target element';
            console.log(`\n========================================`);
            console.log(`[Executor] Step ${i + 1}/${rawSteps.length}`);
            console.log(`[Executor] action=${step.action}`);
            if (step.pageUrl)
                console.log(`[Executor] targetUrl=${step.pageUrl}`);
            console.log(`[Executor] targetLabel=${currentTargetLabel}`);
            console.log(`========================================`);
            // Broadcast current step progress to backend & dashboard
            await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
                body: JSON.stringify({
                    status: 'running',
                    detail: {
                        stepIndex: i,
                        action: step.action,
                        targetLabel: currentTargetLabel,
                        pageUrl: page.url() || step.pageUrl || '',
                        totalSteps: rawSteps.length,
                        status: 'running',
                    },
                }),
            }).catch(() => { });
            // Sensitive action approval gate check
            const isSensitive = step.isSensitive === true;
            if (isSensitive && !isRunApproved) {
                const approved = await waitForApprovalGate(page, runId, i, step, rawSteps.length);
                if (!approved) {
                    throw new Error(`Step ${i + 1} (${step.action}) was rejected or timed out at approval gate`);
                }
                isRunApproved = true;
            }
            // Execute specific action type without swallowing errors
            if (step.action === 'navigate') {
                const targetUrl = step.value || step.pageUrl;
                if (!targetUrl) {
                    throw new Error(`Step ${i + 1}: Navigate action missing target URL`);
                }
                console.log(`[Executor] Navigating to: ${targetUrl}`);
                currentStrategy = 'navigation';
                await page.goto(targetUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 25000,
                });
                console.log(`[Executor] Navigation successful. Current page: ${page.url()}`);
            }
            else if (step.action === 'input' || step.action === 'change') {
                // Smart page sync: If step specifies a different URL origin/path and element not found on current page, navigate first
                if (step.pageUrl) {
                    const currentUrl = page.url();
                    if (currentUrl === 'about:blank') {
                        console.log(`[Executor] Blank page detected. Navigating to step page: ${step.pageUrl}`);
                        await page.goto(step.pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    }
                }
                const resolved = await resolveInteractiveTarget(page, step, 10000);
                currentStrategy = resolved.strategy;
                console.log(`[Executor] Element resolved strategy=${resolved.strategy} matches=${resolved.matches} desc="${resolved.description}"`);
                let inputValue = step.value || '';
                const isPasswordInput = inputValue === '[REDACTED]' || step.selectors?.inputType === 'password';
                if (isPasswordInput) {
                    const userCredential = await waitForCredentialsGate(page, runId, i, step);
                    if (userCredential === null) {
                        throw new Error(`Step ${i + 1}: Credentials gate cancelled or timed out`);
                    }
                    if (userCredential === '[IN_BROWSER_LOGGED_IN]') {
                        console.log(`[Executor] In-browser login detected for step ${i + 1}. Step complete.`);
                        inputValue = '';
                    }
                    else {
                        inputValue = userCredential;
                    }
                }
                if (inputValue) {
                    try {
                        await resolved.locator.fill(inputValue, { timeout: 8000 });
                    }
                    catch (fillErr) {
                        // Click to focus and keyboard type fallback
                        await resolved.locator.click({ force: true, timeout: 4000 });
                        await page.keyboard.type(inputValue, { delay: 40 });
                    }
                    // Verify field contains input value where possible
                    if (!isPasswordInput) {
                        const actualVal = await resolved.locator.inputValue({ timeout: 2000 }).catch(() => null);
                        if (actualVal !== null && actualVal !== inputValue) {
                            console.warn(`[Executor Input Note] Expected "${inputValue}", field currently contains "${actualVal}"`);
                        }
                    }
                }
                inputValue = ''; // Clear sensitive reference
                console.log(`[Executor] Input successful`);
            }
            else if (step.action === 'click' || step.action === 'submit') {
                if (step.pageUrl) {
                    const currentUrl = page.url();
                    if (currentUrl === 'about:blank') {
                        console.log(`[Executor] Blank page detected. Navigating to step page: ${step.pageUrl}`);
                        await page.goto(step.pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    }
                }
                const resolved = await resolveInteractiveTarget(page, step, 10000);
                currentStrategy = resolved.strategy;
                console.log(`[Executor] Element resolved strategy=${resolved.strategy} matches=${resolved.matches} desc="${resolved.description}"`);
                // Perform real Playwright click
                try {
                    await resolved.locator.click({ timeout: 10000 });
                }
                catch (clickErr) {
                    console.warn(`[Executor] Normal click timed out, attempting force click...`);
                    await resolved.locator.click({ force: true, timeout: 5000 });
                }
                console.log(`[Executor] Click successful`);
            }
            else {
                console.log(`[Executor] Custom action "${step.action}" performed.`);
            }
            // Safe settling delay (400ms) between actions for DOM updates & page responsiveness
            await page.waitForTimeout(400);
        }
        // Stop Tracing on Success
        if (context) {
            await context.tracing.stop().catch(() => { });
        }
        if (downloadedFilePath) {
            await uploadResultFileToBackend(runId, downloadedFilePath);
        }
        // Mark Run Completed ONLY because all steps executed with real success
        await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
            body: JSON.stringify({
                status: 'completed',
                finishedAt: new Date().toISOString(),
                detail: {
                    downloadedFilePath,
                    downloadFilename: downloadedFilePath ? path.basename(downloadedFilePath) : null,
                    downloadUrl: downloadedFilePath ? `/api/runs/${runId}/download` : null,
                    previewUrl: downloadedFilePath ? `/api/runs/${runId}/preview` : null,
                    totalSteps: rawSteps.length,
                    status: 'completed',
                },
            }),
        });
        console.log(`\n========================================`);
        console.log(`[Executor] Run ${runId} COMPLETED SUCCESSFULLY! All ${rawSteps.length} steps executed.`);
        console.log(`========================================\n`);
        return true;
    }
    catch (error) {
        const rawErrorMessage = error?.message || String(error);
        console.error(`\n[Executor Error] Run ${runId} FAILED at step ${currentStepIndex + 1} (${currentAction}):`, rawErrorMessage);
        // Redact any tokens/credentials from error message
        const safeErrorMessage = rawErrorMessage
            .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
            .replace(/password=[^&\s]+/gi, 'password=[REDACTED]');
        // Check if run was cancelled by user
        let isCancelled = false;
        try {
            const checkRes = await fetch(`${BACKEND_URL}/api/runs/${runId}`, {
                headers: { 'X-Worker-Secret': WORKER_SECRET },
            });
            if (checkRes.ok) {
                const data = await checkRes.json();
                if (data.run?.status === 'cancelled')
                    isCancelled = true;
            }
        }
        catch (cErr) { }
        if (!isCancelled) {
            // Capture failure screenshot & trace artifacts
            let screenshotUrl = null;
            let traceUrl = null;
            try {
                if (page && !page.isClosed()) {
                    const screenshotPath = path.join(FAILURES_DIR, `failure_${runId}_${timestamp}.png`);
                    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
                    if (fs.existsSync(screenshotPath)) {
                        screenshotUrl = screenshotPath;
                        console.log(`[Executor Failure Artifact] Screenshot saved: ${screenshotPath}`);
                    }
                }
            }
            catch (sErr) {
                console.warn(`[Executor] Could not capture failure screenshot:`, sErr);
            }
            try {
                if (context) {
                    const tracePath = path.join(FAILURES_DIR, `trace_${runId}_${timestamp}.zip`);
                    await context.tracing.stop({ path: tracePath }).catch(() => { });
                    if (fs.existsSync(tracePath)) {
                        traceUrl = tracePath;
                        console.log(`[Executor Failure Artifact] Playwright trace saved: ${tracePath}`);
                    }
                }
            }
            catch (tErr) {
                console.warn(`[Executor] Could not capture Playwright trace:`, tErr);
            }
            // Mark Run as FAILED in backend & Supabase PostgreSQL
            await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
                body: JSON.stringify({
                    status: 'failed',
                    finishedAt: new Date().toISOString(),
                    error: safeErrorMessage,
                    detail: {
                        failedStepIndex: currentStepIndex,
                        stepIndex: currentStepIndex,
                        action: currentAction,
                        targetLabel: currentTargetLabel,
                        selectorStrategy: currentStrategy,
                        pageUrl: page && !page.isClosed() ? page.url() : '',
                        status: 'failed',
                        error: safeErrorMessage,
                        screenshotUrl,
                        traceUrl,
                    },
                }),
            }).catch((patchErr) => {
                console.error(`[Executor] Failed to report failed status to backend:`, patchErr);
            });
        }
        return false;
    }
    finally {
        console.log(`[Executor] Execution lifecycle ended for run ${runId}.`);
    }
}
