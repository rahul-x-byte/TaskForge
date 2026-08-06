import { chromium, Browser, BrowserContext, Page, Locator } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { SelectorBundle, RecordedAction } from '@taskforge/shared';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
const FAILURES_DIR = path.resolve(process.cwd(), 'failures');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(FAILURES_DIR)) fs.mkdirSync(FAILURES_DIR, { recursive: true });

function getFormattedDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Multi-Strategy Selector Resolver (VideoID -> Role -> Text -> TestID -> CSS)
async function resolveSelector(page: Page, selectors: SelectorBundle, timeoutMs = 300): Promise<Locator> {
  if (!selectors) return page.locator('body').first();

  // 1. CSS Selector (fastest & most direct)
  if (selectors.css && selectors.css !== 'body' && selectors.css !== 'html') {
    try {
      const loc = page.locator(selectors.css);
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  // 2. Video ID strategy
  if (selectors.videoId) {
    try {
      const loc = page.locator(`a[href*="${selectors.videoId}"]`);
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  // 3. TestID
  if (selectors.testId) {
    try {
      const loc = page.getByTestId(selectors.testId);
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  // 4. Role + Accessible Name
  if (selectors.role && selectors.name) {
    try {
      const loc = page.getByRole(selectors.role as any, { name: selectors.name });
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  // 5. Visible Text
  if (selectors.text && selectors.text.length < 100) {
    try {
      const loc = page.getByText(selectors.text);
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  return page.locator(selectors.css || 'body').first();
}

// Poll DB/Backend for Approval Gate Resolution (with in-browser navigation auto-approval & 15-minute timeout)
async function waitForApprovalGate(page: Page | null, runId: string, stepIndex: number, stepDetail: any, totalSteps: number = 0): Promise<boolean> {
  const targetLabel = stepDetail.selectors?.name || stepDetail.selectors?.text || stepDetail.selectors?.css || 'Target element';
  const initialUrl = page && !page.isClosed() ? page.url() : '';
  console.log(`[Approval Gate] Run ${runId} paused at step ${stepIndex + 1}/${totalSteps} (${stepDetail.action} on ${targetLabel}). Awaiting approval...`);

  // Update status to awaiting_approval with rich context detail
  await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
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
  });

  const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;
  const startTime = Date.now();

  // Poll status every 1.5 seconds
  while (Date.now() - startTime < APPROVAL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      // 1. Check if user clicked approve/resume via UI
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

      // 2. Check if user submitted form & navigated in browser directly
      if (page && !page.isClosed()) {
        const currentUrl = page.url();
        if (initialUrl && currentUrl !== initialUrl && !currentUrl.includes('/login')) {
          console.log(`[Approval Gate] Detected in-browser form submission & page navigation to ${currentUrl}. Auto-granting approval and resuming!`);
          await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'running',
              detail: { stepIndex, action: stepDetail.action, targetLabel, pageUrl: currentUrl, totalSteps },
            }),
          }).catch(() => {});
          return true;
        }
      }
    } catch (err) {
      console.warn(`[Approval Gate Polling Error]`, err);
    }
  }

  console.log(`[Approval Gate Timeout] Run ${runId} timed out after 15 minutes awaiting approval.`);
  await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'timed_out',
      finishedAt: new Date().toISOString(),
      error: 'Approval gate timed out after 15 minutes',
    }),
  }).catch(() => {});
  return false;
}

// Poll DB/Backend for Credential Input Resolution or In-Browser Login & CAPTCHA Navigation (with 15-minute timeout)
async function waitForCredentialsGate(page: Page | null, runId: string, stepIndex: number, stepDetail: any): Promise<string | null> {
  const fieldLabel = stepDetail.selectors?.name || stepDetail.selectors?.css || 'Password';
  const initialUrl = page && !page.isClosed() ? page.url() : '';
  console.log(`[Interactive Login & Credentials Gate] Run ${runId} paused at step ${stepIndex + 1} for login/credentials (${fieldLabel}). Awaiting user input or in-browser login...`);

  await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'awaiting_login',
      detail: {
        stepIndex,
        fieldLabel,
        message: 'Please enter credentials or log in & solve CAPTCHA in the open browser window. TaskForge will auto-resume once logged in!',
      },
    }),
  });

  const CREDENTIAL_TIMEOUT_MS = 15 * 60 * 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < CREDENTIAL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      // 1. Check in-memory credential store via GET /api/runs/:id/credentials
      const credRes = await fetch(`${BACKEND_URL}/api/runs/${runId}/credentials`);
      if (credRes.ok) {
        const credData = await credRes.json();
        if (credData.found && credData.credential?.value !== undefined) {
          console.log(`[Credentials Gate] Credential received via UI for run ${runId} step ${stepIndex + 1}. Resuming execution.`);
          return credData.credential.value;
        }
      }

      // 2. Check if browser navigated away from initial login URL (in-browser login & CAPTCHA completion)
      if (page && !page.isClosed()) {
        const currentUrl = page.url();
        if (initialUrl && currentUrl !== initialUrl && !currentUrl.includes('/login')) {
          console.log(`[Interactive Login Gate] Detected in-browser login & navigation to ${currentUrl}. Auto-resuming workflow execution!`);
          await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'running' }),
          }).catch(() => {});
          return '[IN_BROWSER_LOGGED_IN]';
        }
      }

      // 3. Check if run was aborted or cancelled
      const runRes = await fetch(`${BACKEND_URL}/api/runs/${runId}`);
      if (runRes.ok) {
        const data = await runRes.json();
        const currentStatus = data.run?.status;
        if (currentStatus === 'cancelled' || currentStatus === 'failed') {
          console.log(`[Credentials Gate] Run ${runId} was cancelled/aborted.`);
          return null;
        }
      }
    } catch (err) {
      console.warn(`[Credentials Gate Polling Error]`, err);
    }
  }

  console.log(`[Credentials Gate Timeout] Run ${runId} timed out after 15 minutes awaiting credentials or login.`);
  await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'timed_out',
      finishedAt: new Date().toISOString(),
      error: 'Credential entry / login timed out after 15 minutes',
    }),
  }).catch(() => {});
  return null;
}

export async function executeWorkflowRun(workflowId: string, versionId: string, runId: string): Promise<boolean> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  const timestamp = Date.now();
  let currentStepIndex = 0;
  let downloadedFilePath: string | null = null;
  let isRunApproved = false;

  try {
    // 1. Fetch Workflow Version & Steps
    const wfRes = await fetch(`${BACKEND_URL}/api/workflows/${workflowId}`);
    if (!wfRes.ok) {
      throw new Error(`Failed to load workflow ${workflowId}`);
    }
    const wfData = await wfRes.json();
    const rawSteps: (RecordedAction & { isSensitive?: boolean })[] = wfData.steps || [];

    console.log(`[Executor] Starting execution for Run ${runId} (Workflow: ${wfData.name}, Total Steps: ${rawSteps.length})`);

    // Update status to running
    await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });

    // 2. Launch Browser & Tracing
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({ acceptDownloads: true });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();

    // Global Download Handler: Automatically catch and save ANY file downloaded during workflow execution
    page.on('download', async (download) => {
      try {
        const origFilename = download.suggestedFilename() || `result_download_${Date.now()}.pdf`;
        const destPath = path.join(DOWNLOADS_DIR, origFilename);
        await download.saveAs(destPath);
        downloadedFilePath = destPath;
        console.log(`[Executor Global Download Handler] Successfully saved file download to local disk: ${destPath}`);
      } catch (dErr) {
        console.error(`[Executor Global Download Error] Failed to save download:`, dErr);
      }
    });

    // New Tab & Popup Download / PDF Response Capture
    context.on('page', async (newPage) => {
      newPage.on('download', async (download) => {
        try {
          const origFilename = download.suggestedFilename() || `result_report_${Date.now()}.pdf`;
          const destPath = path.join(DOWNLOADS_DIR, origFilename);
          await download.saveAs(destPath);
          downloadedFilePath = destPath;
          console.log(`[Executor Popup Tab Download] Saved file to disk: ${destPath}`);
        } catch (e) {}
      });

      newPage.on('response', async (res) => {
        try {
          const ct = res.headers()['content-type'] || '';
          const resUrl = res.url();
          if (ct.includes('application/pdf') || ct.includes('application/octet-stream') || resUrl.endsWith('.pdf')) {
            const buffer = await res.body();
            const filename = `result_report_${Date.now()}.pdf`;
            const destPath = path.join(DOWNLOADS_DIR, filename);
            fs.writeFileSync(destPath, buffer);
            downloadedFilePath = destPath;
            console.log(`[Executor Popup PDF Response] Captured PDF report and saved to disk: ${destPath}`);
          }
        } catch (e) {}
      });
    });

    // 3. Step Execution Loop
    for (let i = 0; i < rawSteps.length; i++) {
      currentStepIndex = i;
      const step = rawSteps[i];
      const targetLabel = step.selectors?.name || step.selectors?.text || step.selectors?.css || 'Target element';
      console.log(`[Executor] Executing Step ${i + 1}/${rawSteps.length}: ${step.action} on ${targetLabel}`, step);

      // Broadcast current step progress
      await fetch(`${BACKEND_URL}/api/runs/${runId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'running',
          detail: { stepIndex: i, action: step.action, targetLabel, pageUrl: step.pageUrl || '', totalSteps: rawSteps.length },
        }),
      }).catch(() => {});

      // Smart Page Navigation Sync: Navigate if URL path differs and target element isn't visible on current page
      const currentUrl = page.url();
      if (step.pageUrl) {
        try {
          const parsedTarget = new URL(step.pageUrl);
          const parsedCurrent = currentUrl !== 'about:blank' ? new URL(currentUrl) : null;
          
          const isDifferentPage = !parsedCurrent ||
            parsedCurrent.origin !== parsedTarget.origin ||
            parsedCurrent.pathname !== parsedTarget.pathname;

          if (isDifferentPage) {
            let elementExists = false;
            if (step.selectors) {
              const testLoc = await resolveSelector(page, step.selectors, 500);
              elementExists = await testLoc.isVisible().catch(() => false);
            }
            if (!elementExists) {
              console.log(`[Executor] Navigating to step page: ${step.pageUrl}`);
              await page.goto(step.pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            }
          }
        } catch (uErr) {
          if (currentUrl === 'about:blank') {
            await page.goto(step.pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          }
        }
      }

      // Check for Sensitive Step Approval Gate (Strictly explicit sensitivity only, set by user or automatic recording rule)
      const isSensitive = step.isSensitive === true;
      if (isSensitive && !isRunApproved) {
        const approved = await waitForApprovalGate(page, runId, i, step, rawSteps.length);
        if (!approved) {
          throw new Error(`Execution aborted at step ${i + 1}: Approval gate cancelled or timed out.`);
        }
        isRunApproved = true;
      }

      // Execute Action based on type
      if (step.action === 'navigate') {
        const targetUrl = step.value || step.pageUrl || 'http://localhost:3001/login';
        console.log(`[Executor] Navigating explicitly to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      } else if (step.action === 'input' || step.action === 'change') {
        const locator = await resolveSelector(page, step.selectors, 300);
        await locator.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        let inputValue = step.value || '';
        const isPasswordInput = inputValue === '[REDACTED]' || step.selectors?.inputType === 'password';

        if (isPasswordInput) {
          const userCredential = await waitForCredentialsGate(page, runId, i, step);
          if (userCredential === null) {
            throw new Error(`Execution aborted at step ${i + 1}: Credential gate cancelled or timed out.`);
          }
          if (userCredential === '[IN_BROWSER_LOGGED_IN]') {
            console.log(`[Executor] User completed in-browser login & CAPTCHA. Auto-resuming next step.`);
            continue;
          }
          inputValue = userCredential;
        }

        try {
          await locator.fill(inputValue, { timeout: 3000 });
        } catch (fillErr) {
          await locator.click({ force: true }).catch(() => {});
          await page.keyboard.type(inputValue).catch(() => {});
        }
        inputValue = ''; // Immediately clear secret string reference

      } else if (step.action === 'click' || step.action === 'submit') {
        const locator = await resolveSelector(page, step.selectors, 300);
        try {
          await locator.click({ timeout: 5000 }).catch(() => locator.click({ force: true, timeout: 3000 }));
        } catch (clickErr) {
          console.warn(`[Executor Click Warning] Step ${i + 1}:`, clickErr);
        }
      }

      // Fast pace delay (50ms) for maximum execution speed
      await page.waitForTimeout(50);
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
        detail: {
          downloadedFilePath,
          downloadFilename: downloadedFilePath ? path.basename(downloadedFilePath) : null,
          downloadUrl: downloadedFilePath ? `/api/runs/${runId}/download` : null,
          previewUrl: downloadedFilePath ? `/api/runs/${runId}/preview` : null,
        },
      }),
    });

    console.log(`[Executor] Run ${runId} completed successfully! Browser window kept open for user.`);
    return true;

  } catch (error: any) {
    console.error(`[Executor Error] Run ${runId} failed at step ${currentStepIndex + 1}:`, error?.message || error);

    // Check if run was explicitly cancelled before setting status to failed
    let isCancelled = false;
    try {
      const checkRes = await fetch(`${BACKEND_URL}/api/runs/${runId}`);
      if (checkRes.ok) {
        const data = await checkRes.json();
        if (data.run?.status === 'cancelled') {
          isCancelled = true;
        }
      }
    } catch (cErr) {}

    if (!isCancelled) {
      // Save Screenshot & Playwright Trace on Failure
      let screenshotUrl: string | null = null;
      let traceUrl: string | null = null;

      const activePage: Page | null = page;
      if (activePage && !activePage.isClosed()) {
        try {
          const screenshotPath = path.join(FAILURES_DIR, `${timestamp}.png`);
          await activePage.screenshot({ path: screenshotPath, fullPage: true });
          screenshotUrl = screenshotPath;
          console.log(`[Executor Failure] Screenshot saved: ${screenshotPath}`);
        } catch (sErr) {}
      }

      if (context) {
        try {
          const tracePath = path.join(FAILURES_DIR, `${timestamp}.zip`);
          await context.tracing.stop({ path: tracePath });
          traceUrl = tracePath;
          console.log(`[Executor Failure] Trace saved: ${tracePath}`);
        } catch (tErr) {}
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
    }

    return false;

  } finally {
    // Keep browser window open so user can view/interact with the page after completion
    console.log(`[Executor] Execution finished. Browser window remains open.`);
  }
}
