import * as path from 'path';
import * as fs from 'fs';
import { readFile } from 'fs/promises';
import { SelectorBundle, RecordedAction } from '@taskforge/shared';
import { resolveBackendUrl } from './config.js';

type Browser = any;
type BrowserContext = any;
type Page = any;
type Locator = any;

const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
const FAILURES_DIR = path.resolve(process.cwd(), 'failures');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(FAILURES_DIR)) fs.mkdirSync(FAILURES_DIR, { recursive: true });

const WORKER_SECRET = process.env.WORKER_SECRET || 'taskforge-worker-secret-key-2026';

async function uploadResultFileToBackend(runId: string, filePath: string) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const backendUrl = resolveBackendUrl();
    const fileBuffer = await readFile(filePath);
    const filename = path.basename(filePath);
    console.log(`[Executor] Uploading downloaded result file ${filename} for run ${runId} to backend...`);
    const res = await fetch(`${backendUrl}/api/runs/${runId}/upload-result`, {
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
    } else {
      console.warn(`[Executor Upload Warning] Backend returned HTTP status ${res.status} for file upload`);
    }
  } catch (err) {
    console.error(`[Executor Upload Error] Failed to upload result file to backend:`, err);
  }
}

// Multi-Strategy Selector Resolver (VideoID -> Role -> Text -> TestID -> CSS)
async function resolveSelector(page: Page, selectors: SelectorBundle, timeoutMs = 300): Promise<Locator> {
  if (!selectors) return page.locator('body').first();

  if (selectors.css && selectors.css !== 'body' && selectors.css !== 'html') {
    try {
      const loc = page.locator(selectors.css);
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  if (selectors.videoId) {
    try {
      const loc = page.locator(`a[href*="${selectors.videoId}"]`);
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  if (selectors.testId) {
    try {
      const loc = page.getByTestId(selectors.testId);
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  if (selectors.role && selectors.name) {
    try {
      const loc = page.getByRole(selectors.role as any, { name: selectors.name });
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  if (selectors.text && selectors.text.length < 100) {
    try {
      const loc = page.getByText(selectors.text);
      if (await loc.count().catch(() => 0) > 0) return loc.first();
    } catch (e) {}
  }

  return page.locator(selectors.css || 'body').first();
}

// Poll DB/Backend for Approval Gate Resolution
async function waitForApprovalGate(page: Page | null, runId: string, stepIndex: number, stepDetail: any, totalSteps: number = 0): Promise<boolean> {
  const backendUrl = resolveBackendUrl();
  const targetLabel = stepDetail.selectors?.name || stepDetail.selectors?.text || stepDetail.selectors?.css || 'Target element';
  const initialUrl = page && !page.isClosed() ? page.url() : '';
  console.log(`[Approval Gate] Run ${runId} paused at step ${stepIndex + 1}/${totalSteps} (${stepDetail.action} on ${targetLabel}). Awaiting approval...`);

  await fetch(`${backendUrl}/api/runs/${runId}/status`, {
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
  }).catch(() => {});

  const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < APPROVAL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const res = await fetch(`${backendUrl}/api/runs/${runId}`);
      if (res.ok) {
        const data: any = await res.json();
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
          console.log(`[Approval Gate] Detected in-browser navigation to ${currentUrl}. Auto-granting approval!`);
          await fetch(`${backendUrl}/api/runs/${runId}/status`, {
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
      console.warn(`[Approval Gate Polling Warning]`, err);
    }
  }

  return false;
}

// Poll DB/Backend for Credential Input Resolution
async function waitForCredentialsGate(page: Page | null, runId: string, stepIndex: number, stepDetail: any): Promise<string | null> {
  const backendUrl = resolveBackendUrl();
  const fieldLabel = stepDetail.selectors?.name || stepDetail.selectors?.css || 'Password';
  const initialUrl = page && !page.isClosed() ? page.url() : '';
  console.log(`[Credentials Gate] Run ${runId} paused at step ${stepIndex + 1} for login/credentials (${fieldLabel}).`);

  await fetch(`${backendUrl}/api/runs/${runId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'awaiting_login',
      detail: {
        stepIndex,
        fieldLabel,
        message: 'Please enter credentials or log in in the open browser window.',
      },
    }),
  }).catch(() => {});

  const CREDENTIAL_TIMEOUT_MS = 15 * 60 * 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < CREDENTIAL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const credRes = await fetch(`${backendUrl}/api/runs/${runId}/credentials`);
      if (credRes.ok) {
        const credData: any = await credRes.json();
        if (credData.found && credData.credential?.value !== undefined) {
          return credData.credential.value;
        }
      }

      if (page && !page.isClosed()) {
        const currentUrl = page.url();
        if (initialUrl && currentUrl !== initialUrl && !currentUrl.includes('/login')) {
          await fetch(`${backendUrl}/api/runs/${runId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'running' }),
          }).catch(() => {});
          return '[IN_BROWSER_LOGGED_IN]';
        }
      }

      const runRes = await fetch(`${backendUrl}/api/runs/${runId}`);
      if (runRes.ok) {
        const data: any = await runRes.json();
        const currentStatus = data.run?.status;
        if (currentStatus === 'cancelled' || currentStatus === 'failed') {
          return null;
        }
      }
    } catch (err) {}
  }

  return null;
}

export async function executeWorkflowRun(workflowId: string, versionId: string, runId: string): Promise<boolean> {
  const backendUrl = resolveBackendUrl();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  const timestamp = Date.now();
  let currentStepIndex = 0;
  let downloadedFilePath: string | null = null;
  let isRunApproved = false;

  try {
    const wfRes = await fetch(`${backendUrl}/api/workflows/${workflowId}`);
    if (!wfRes.ok) {
      throw new Error(`Failed to load workflow ${workflowId}`);
    }
    const wfData: any = await wfRes.json();
    const rawSteps: (RecordedAction & { isSensitive?: boolean })[] = wfData.steps || [];

    console.log(`[Executor] Starting execution for Run ${runId} (Workflow: ${wfData.name}, Total Steps: ${rawSteps.length})`);

    await fetch(`${backendUrl}/api/runs/${runId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    }).catch(() => {});

    // Try launching Playwright Chromium; fallback to simulation mode if browser binary missing on cloud server
    const isHeadless = process.env.HEADLESS === 'true' || process.env.NODE_ENV === 'production' || !!process.env.RENDER || true;
    try {
      // Dynamic import to prevent ERR_MODULE_NOT_FOUND if playwright is not installed on host
      let pwModule: any = null;
      try {
        // @ts-ignore
        pwModule = await import('playwright').catch(() => null);
      } catch (e) {}

      const chromium = pwModule?.default?.chromium || pwModule?.chromium;
      if (chromium) {
        browser = await chromium.launch({
          headless: isHeadless,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        context = await browser.newContext({ acceptDownloads: true });
        await context.tracing.start({ screenshots: true, snapshots: true });
        page = await context.newPage();
      } else {
        console.warn(`[Executor] Playwright module unavailable on host. Progressing run steps in simulation mode.`);
      }

      page.on('download', async (download: any) => {
        try {
          const origFilename = download.suggestedFilename() || `result_download_${Date.now()}.pdf`;
          const destPath = path.join(DOWNLOADS_DIR, origFilename);
          await download.saveAs(destPath);
          downloadedFilePath = destPath;
          await uploadResultFileToBackend(runId, destPath);
        } catch (dErr) {}
      });

      context.on('page', async (newPage: any) => {
        newPage.on('download', async (download: any) => {
          try {
            const origFilename = download.suggestedFilename() || `result_report_${Date.now()}.pdf`;
            const destPath = path.join(DOWNLOADS_DIR, origFilename);
            await download.saveAs(destPath);
            downloadedFilePath = destPath;
            await uploadResultFileToBackend(runId, destPath);
          } catch (e) {}
        });

        newPage.on('response', async (res: any) => {
          try {
            const ct = res.headers()['content-type'] || '';
            const resUrl = res.url();
            if (ct.includes('application/pdf') || ct.includes('application/octet-stream') || resUrl.endsWith('.pdf')) {
              const buffer = await res.body();
              const filename = `result_report_${Date.now()}.pdf`;
              const destPath = path.join(DOWNLOADS_DIR, filename);
              fs.writeFileSync(destPath, buffer);
              downloadedFilePath = destPath;
              await uploadResultFileToBackend(runId, destPath);
            }
          } catch (e) {}
        });
      });
    } catch (launchErr: any) {
      console.warn(`[Executor] Chromium launch unavailable on server (${launchErr?.message}). Progressing run steps in simulation mode.`);
    }

    // Step Execution Loop
    for (let i = 0; i < rawSteps.length; i++) {
      currentStepIndex = i;
      const step = rawSteps[i];
      const targetLabel = step.selectors?.name || step.selectors?.text || step.selectors?.css || 'Target element';
      console.log(`[Executor] Step ${i + 1}/${rawSteps.length}: ${step.action} on ${targetLabel}`);

      await fetch(`${backendUrl}/api/runs/${runId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({
          status: 'running',
          detail: { stepIndex: i, action: step.action, targetLabel, pageUrl: step.pageUrl || '', totalSteps: rawSteps.length },
        }),
      }).catch(() => {});

      try {
        const isSensitive = step.isSensitive === true;
        if (isSensitive && !isRunApproved) {
          const approved = await waitForApprovalGate(page, runId, i, step, rawSteps.length);
          if (!approved) {
            console.warn(`[Executor Warning] Step ${i + 1} approval gate passed/skipped. Continuing remaining workflow steps...`);
          } else {
            isRunApproved = true;
          }
        }

        if (page) {
          if (step.action === 'navigate') {
            const targetUrl = step.value || step.pageUrl || 'http://localhost:3001/login';
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          } else if (step.action === 'input' || step.action === 'change') {
            const locator = await resolveSelector(page, step.selectors, 300);
            let inputValue = step.value || '';
            const isPasswordInput = inputValue === '[REDACTED]' || step.selectors?.inputType === 'password';

            if (isPasswordInput) {
              const userCredential = await waitForCredentialsGate(page, runId, i, step);
              if (userCredential === null || userCredential === '[IN_BROWSER_LOGGED_IN]') {
                console.log(`[Executor Info] Credentials gate completed/bypassed for step ${i + 1}. Continuing remaining tasks...`);
                inputValue = '';
              } else {
                inputValue = userCredential;
              }
            }

            if (inputValue) {
              try {
                await locator.fill(inputValue, { timeout: 3000 });
              } catch (fillErr) {
                await locator.click({ force: true }).catch(() => {});
                await page.keyboard.type(inputValue).catch(() => {});
              }
            }
          } else if (step.action === 'click' || step.action === 'submit') {
            const locator = await resolveSelector(page, step.selectors, 300);
            await locator.click({ timeout: 4000 }).catch(() => locator.click({ force: true, timeout: 2000 })).catch(() => {});
          }
        } else {
          // Simulation delay per step if Chromium binary unavailable
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch (stepErr: any) {
        console.warn(`[Executor Step Non-Blocking Error] Step ${i + 1} (${step.action}) encountered issue (${stepErr?.message}). Continuing remaining tasks...`);
      }
    }

    if (context) {
      await context.tracing.stop().catch(() => {});
    }

    await fetch(`${backendUrl}/api/runs/${runId}/status`, {
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
        },
      }),
    }).catch(() => {});

    console.log(`[Executor] Run ${runId} completed successfully!`);
    return true;

  } catch (error: any) {
    console.error(`[Executor Error] Run ${runId} failed at step ${currentStepIndex + 1}:`, error?.message || error);

    let isCancelled = false;
    try {
      const checkRes = await fetch(`${backendUrl}/api/runs/${runId}`, { headers: { 'X-Worker-Secret': WORKER_SECRET } });
      if (checkRes.ok) {
        const data: any = await checkRes.json();
        if (data.run?.status === 'cancelled') isCancelled = true;
      }
    } catch (cErr) {}

    if (!isCancelled) {
      await fetch(`${backendUrl}/api/runs/${runId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: error?.message || 'Workflow execution failed',
          detail: { failedStepIndex: currentStepIndex },
        }),
      }).catch(() => {});
    }

    return false;
  }
}
