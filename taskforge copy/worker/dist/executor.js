import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
const FAILURES_DIR = path.resolve(process.cwd(), 'failures');
if (!fs.existsSync(DOWNLOADS_DIR))
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(FAILURES_DIR))
    fs.mkdirSync(FAILURES_DIR, { recursive: true });
function getFormattedDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
// Multi-Strategy Selector Resolver (Role -> Text -> TestID -> CSS)
function resolveSelector(page, selectors) {
    if (!selectors) {
        throw new Error('No selector bundle provided for step.');
    }
    // 1. Role + Accessible Name
    if (selectors.role && selectors.name) {
        try {
            return page.getByRole(selectors.role, { name: selectors.name });
        }
        catch (e) { }
    }
    // 2. Visible Text
    if (selectors.text) {
        try {
            return page.getByText(selectors.text);
        }
        catch (e) { }
    }
    // 3. TestID
    if (selectors.testId) {
        try {
            return page.getByTestId(selectors.testId);
        }
        catch (e) { }
    }
    // 4. CSS Fallback Selector
    if (selectors.css) {
        return page.locator(selectors.css);
    }
    throw new Error(`Could not resolve any valid selector strategy for target: ${JSON.stringify(selectors)}`);
}
// Poll DB/Backend for Approval Gate Resolution
async function waitForApprovalGate(runId, stepIndex, stepDetail) {
    console.log(`[Approval Gate] Run ${runId} paused at step ${stepIndex + 1} (Sensitive Action). Awaiting approval...`);
    // Update status to awaiting_approval
    await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            status: 'awaiting_approval',
            detail: { stepIndex, stepDetail },
        }),
    });
    // Poll status every 2 seconds
    while (true) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
            const res = await fetch(`${BACKEND_URL}/api/runs/${runId}`);
            if (res.ok) {
                const data = await res.json();
                const currentStatus = data.run?.status;
                console.log(`[Approval Gate] Polling run ${runId} status: ${currentStatus}`);
                if (currentStatus === 'running' || currentStatus === 'approved') {
                    console.log(`[Approval Gate] Approval granted for run ${runId}. Resuming execution.`);
                    return true;
                }
                if (currentStatus === 'cancelled' || currentStatus === 'failed') {
                    console.log(`[Approval Gate] Run ${runId} was cancelled/aborted.`);
                    return false;
                }
            }
        }
        catch (err) {
            console.warn(`[Approval Gate Polling Error]`, err);
        }
    }
}
export async function executeWorkflowRun(workflowId, versionId, runId) {
    let browser = null;
    let context = null;
    let page = null;
    const timestamp = Date.now();
    let currentStepIndex = 0;
    let downloadedFilePath = null;
    try {
        // 1. Fetch Workflow Version & Steps
        const wfRes = await fetch(`${BACKEND_URL}/api/workflows/${workflowId}`);
        if (!wfRes.ok) {
            throw new Error(`Failed to load workflow ${workflowId}`);
        }
        const wfData = await wfRes.json();
        const rawSteps = wfData.steps || [];
        console.log(`[Executor] Starting execution for Run ${runId} (Workflow: ${wfData.name}, Total Steps: ${rawSteps.length})`);
        // Update status to running
        await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'running' }),
        });
        // 2. Launch Browser & Tracing
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ acceptDownloads: true });
        await context.tracing.start({ screenshots: true, snapshots: true });
        page = await context.newPage();
        // 3. Step Execution Loop
        for (let i = 0; i < rawSteps.length; i++) {
            currentStepIndex = i;
            const step = rawSteps[i];
            console.log(`[Executor] Executing Step ${i + 1}/${rawSteps.length}: ${step.action}`, step);
            // Ensure page URL matches step pageUrl if needed
            if (step.pageUrl && !page.url().includes(step.pageUrl)) {
                await page.goto(step.pageUrl, { waitUntil: 'networkidle' }).catch(() => { });
            }
            // Check for Sensitive Step Approval Gate
            const isSensitive = step.isSensitive || step.action === 'submit' || (step.selectors?.css && step.selectors.css.includes('submit'));
            if (isSensitive) {
                const approved = await waitForApprovalGate(runId, i, step);
                if (!approved) {
                    throw new Error(`Execution aborted at step ${i + 1}: Approval gate cancelled.`);
                }
            }
            // Execute Action based on type
            if (step.action === 'navigate') {
                const targetUrl = step.value || step.pageUrl || 'http://localhost:3001/login';
                await page.goto(targetUrl, { waitUntil: 'networkidle' });
            }
            else if (step.action === 'input' || step.action === 'change') {
                const locator = resolveSelector(page, step.selectors);
                await locator.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
                let inputValue = step.value || '';
                if (inputValue === '[REDACTED]') {
                    inputValue = process.env.TEST_PASSWORD || 'password123';
                }
                await locator.fill(inputValue);
            }
            else if (step.action === 'click' || step.action === 'submit') {
                const locator = resolveSelector(page, step.selectors);
                await locator.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
                // Check if action triggers report download
                const isDownloadAction = step.selectors?.text?.includes('Download') || step.selectors?.css?.includes('download');
                if (isDownloadAction) {
                    const [download] = await Promise.all([
                        page.waitForEvent('download'),
                        locator.click(),
                    ]);
                    const targetFilename = `attendance_report_${getFormattedDate()}.csv`;
                    downloadedFilePath = path.join(DOWNLOADS_DIR, targetFilename);
                    await download.saveAs(downloadedFilePath);
                    console.log(`[Executor] Downloaded report file saved: ${downloadedFilePath}`);
                }
                else {
                    await locator.click();
                    await page.waitForLoadState('networkidle').catch(() => { });
                }
            }
        }
        // Stop Tracing on Success
        await context.tracing.stop();
        // Mark Run Completed
        await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'completed',
                finishedAt: new Date().toISOString(),
                detail: { downloadedFilePath },
            }),
        });
        console.log(`[Executor] Run ${runId} completed successfully! Output file: ${downloadedFilePath}`);
        return true;
    }
    catch (error) {
        console.error(`[Executor Error] Run ${runId} failed at step ${currentStepIndex + 1}:`, error?.message || error);
        // Save Screenshot & Playwright Trace on Failure
        let screenshotUrl = null;
        let traceUrl = null;
        if (page && !page.isClosed()) {
            try {
                const screenshotPath = path.join(FAILURES_DIR, `${timestamp}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                screenshotUrl = screenshotPath;
                console.log(`[Executor Failure] Screenshot saved: ${screenshotPath}`);
            }
            catch (sErr) { }
        }
        if (context) {
            try {
                const tracePath = path.join(FAILURES_DIR, `${timestamp}.zip`);
                await context.tracing.stop({ path: tracePath });
                traceUrl = tracePath;
                console.log(`[Executor Failure] Trace saved: ${tracePath}`);
            }
            catch (tErr) { }
        }
        // Update Status to Failed
        await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'failed',
                finishedAt: new Date().toISOString(),
                error: error?.message || 'Workflow execution failed',
                detail: { screenshotUrl, traceUrl, failedStepIndex: currentStepIndex },
            }),
        });
        return false;
    }
    finally {
        if (context)
            await context.close().catch(() => { });
        if (browser)
            await browser.close().catch(() => { });
    }
}
