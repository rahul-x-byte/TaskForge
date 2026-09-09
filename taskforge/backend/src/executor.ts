import playwright, { type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import { SelectorBundle, RecordedAction } from '@taskforge/shared';
import { pool } from './db/index.js';
import { updateRunStatus } from './runStatus.js';

const { chromium } = playwright;
const esmRequire = createRequire(import.meta.url);

export function getPlaywrightDiagnostics(): {
  version: string;
  executablePath: string;
  browsersPath: string;
  executableExists: boolean;
} {
  let version = 'unknown';
  try {
    const pkg = esmRequire('playwright/package.json');
    version = pkg?.version || '1.63.0';
  } catch {
    try {
      const corePkg = esmRequire('playwright-core/package.json');
      version = corePkg?.version || '1.63.0';
    } catch {
      version = '1.63.0';
    }
  }

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || '(default: ~/.cache/ms-playwright)';
  let execPath = 'unknown';
  let executableExists = false;

  try {
    execPath = chromium.executablePath();
    executableExists = Boolean(execPath && fs.existsSync(execPath));
  } catch (err: any) {
    execPath = `Error resolving path: ${err?.message || err}`;
  }

  return {
    version,
    executablePath: execPath,
    browsersPath,
    executableExists,
  };
}

export function logPlaywrightDiagnostics(): {
  version: string;
  executablePath: string;
  browsersPath: string;
  executableExists: boolean;
} {
  const diag = getPlaywrightDiagnostics();
  console.log('[Playwright Startup Diagnostics]', {
    playwrightVersion: diag.version,
    executablePath: diag.executablePath,
    playwrightBrowsersPath: diag.browsersPath,
    executableExists: diag.executableExists,
  });
  return diag;
}

const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
const FAILURES_DIR = path.resolve(process.cwd(), 'failures');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(FAILURES_DIR)) fs.mkdirSync(FAILURES_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export class ElementNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ElementNotFoundError';
  }
}

async function saveResultFileDirectly(runId: string, filePath: string): Promise<string | null> {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const filename = path.basename(filePath);
    const destPath = path.join(UPLOADS_DIR, filename);
    if (filePath !== destPath) {
      fs.copyFileSync(filePath, destPath);
    }
    console.log(`[Executor] Result file ${filename} saved to uploads directly for run ${runId}`);
    return filename;
  } catch (err) {
    console.error(`[Executor File Save Error] Failed to save result file:`, err);
    return null;
  }
}

interface ResolvedTarget {
  locator: Locator;
  strategy: string;
  description: string;
  matches: number;
}

// Multi-Strategy Selector Resolver (VideoID -> Role + Name -> Placeholder -> TestID -> Stable CSS -> Visible Text -> Interactive Ancestor -> Resilient Fallbacks)
// STRICT: Never falls back to BODY. Throws ElementNotFoundError if no matching interactive element is found.
async function resolveInteractiveTarget(
  page: Page,
  step: RecordedAction,
  timeoutMs = 8000
): Promise<ResolvedTarget> {
  const selectors = step.selectors;
  if (!selectors) {
    throw new ElementNotFoundError(`No selectors provided for step action "${step.action}"`);
  }

  const isClickAction = step.action === 'click' || step.action === 'submit';
  const isInputAction = step.action === 'input' || step.action === 'change';
  const attempted: string[] = [];

  async function testCandidate(locator: Locator, strategyName: string, desc: string): Promise<ResolvedTarget | null> {
    attempted.push(strategyName);
    try {
      await locator.first().waitFor({ state: 'attached', timeout: Math.min(timeoutMs, 3000) }).catch(() => {});
      const count = await locator.count();
      if (count === 0) return null;

      // Find first visible and operable candidate among matches (avoiding hidden file inputs or hidden overlays)
      let targetLoc: Locator | null = null;
      for (let idx = 0; idx < Math.min(count, 5); idx++) {
        const candidate = locator.nth(idx);
        const isVis = await candidate.isVisible().catch(() => false);
        if (isVis) {
          targetLoc = candidate;
          break;
        }
      }

      if (!targetLoc) {
        targetLoc = locator.first();
      }

      if (isInputAction) {
        const tagName = await targetLoc.evaluate((el: any) => el.tagName ? el.tagName.toLowerCase() : '').catch(() => '');
        const isContentEditable = await targetLoc.evaluate((el: any) => !!el.isContentEditable).catch(() => false);
        if (!['input', 'textarea', 'select'].includes(tagName) && !isContentEditable) {
          const innerInput = targetLoc.locator('input:not([type="hidden"]):not([type="file"]), textarea, select, [contenteditable="true"]').first();
          if (await innerInput.count().catch(() => 0) > 0) {
            targetLoc = innerInput;
          }
        }
        await targetLoc.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        const isEditable = await targetLoc.isEditable({ timeout: 2000 }).catch(() => true);
        if (!isEditable) return null;
      }

      if (isClickAction) {
        const isVisible = await targetLoc.isVisible().catch(() => false);
        if (!isVisible) {
          const innerClickable = targetLoc.locator('a, button, [role="button"], input[type="submit"]').first();
          if (await innerClickable.count().catch(() => 0) > 0 && await innerClickable.isVisible().catch(() => false)) {
            targetLoc = innerClickable;
          } else {
            return null;
          }
        }
      }

      return { locator: targetLoc, strategy: strategyName, description: desc, matches: count };
    } catch {
      return null;
    }
  }

  // Strategy 1: VideoID Link Selector
  if (selectors.videoId) {
    const loc = page.locator(`a[href*="${selectors.videoId}"]`);
    const res = await testCandidate(loc, 'videoId', `a[href*="${selectors.videoId}"]`);
    if (res) return res;
  }

  // Strategy 2: Role + Accessible Name
  if (selectors.role && selectors.name) {
    try {
      const loc = (page as any).getByRole(selectors.role, { name: selectors.name, exact: false });
      const res = await testCandidate(loc, 'role+name', `role=${selectors.role} name="${selectors.name}"`);
      if (res) return res;
    } catch {}
  }

  // Strategy 2b: Placeholder Selector
  if (selectors.placeholder) {
    try {
      const loc = (page as any).getByPlaceholder(selectors.placeholder, { exact: false });
      const res = await testCandidate(loc, 'placeholder', `placeholder="${selectors.placeholder}"`);
      if (res) return res;
    } catch {}
  }

  // Strategy 3: Stable TestID Attributes
  if (selectors.testId) {
    const loc = page.locator(`[data-testid="${selectors.testId}"], [data-test-id="${selectors.testId}"], [data-cy="${selectors.testId}"]`);
    const res = await testCandidate(loc, 'testId', `testid="${selectors.testId}"`);
    if (res) return res;
  }

  // Strategy 4: High-Quality Recorded CSS
  if (selectors.css && selectors.css !== 'body' && selectors.css !== 'html') {
    const loc = page.locator(selectors.css);
    const res = await testCandidate(loc, 'css', selectors.css);
    if (res) return res;
  }

  // Strategy 5: Visible Text Exact & Substring Match
  if (selectors.text && selectors.text.trim().length > 1) {
    const trimmed = selectors.text.trim();
    try {
      const loc = (page as any).getByText(trimmed, { exact: true });
      const res = await testCandidate(loc, 'text-exact', `text="${trimmed}"`);
      if (res) return res;
    } catch {}

    try {
      const loc = (page as any).getByText(trimmed, { exact: false });
      const res = await testCandidate(loc, 'text-contains', `text~="${trimmed}"`);
      if (res) return res;
    } catch {}
  }

  // Strategy 6: Accessible Name Only
  if (selectors.name) {
    try {
      const loc = page.locator(`[aria-label="${selectors.name}"], [title="${selectors.name}"], [name="${selectors.name}"]`);
      const res = await testCandidate(loc, 'name-attribute', `name="${selectors.name}"`);
      if (res) return res;
    } catch {}
  }

  // Strategy 7: Interactive Ancestor
  if (selectors.interactiveAncestor) {
    const loc = page.locator(selectors.interactiveAncestor);
    const res = await testCandidate(loc, 'interactiveAncestor', selectors.interactiveAncestor);
    if (res) return res;
  }

  // Strategy 8: Resilient Input / Search / Button Fallbacks
  if (isInputAction) {
    const inputFallbacks = [
      'input[name="search_query"]',
      'yt-searchbox input:not([type="file"])',
      'input[type="search"]',
      'input[type="text"]:not([type="hidden"])',
      '[role="searchbox"]',
      'input:not([type="hidden"]):not([type="file"])',
    ];
    for (const fb of inputFallbacks) {
      const loc = page.locator(fb);
      const res = await testCandidate(loc, `input-fallback:${fb}`, fb);
      if (res) return res;
    }
  }

  if (isClickAction) {
    const clickFallbacks = [
      'ytd-video-renderer a#video-title',
      'a#video-title',
      'ytd-video-renderer a#thumbnail',
      'a[href*="/watch?v="]',
    ];
    for (const fb of clickFallbacks) {
      const loc = page.locator(fb);
      const res = await testCandidate(loc, `click-fallback:${fb}`, fb);
      if (res) return res;
    }
  }

  throw new ElementNotFoundError(
    `Failed to locate interactive element for action "${step.action}". Attempted strategies: [${attempted.join(', ')}]. No candidates matched.`
  );
}

// Approval Gate Pauser (IDOR-safe polling directly against database)
async function waitForApprovalGate(
  page: Page,
  runId: string,
  stepIndex: number,
  step: RecordedAction,
  totalSteps: number,
  timeoutMs = 60000
): Promise<boolean> {
  console.log(`\n========================================`);
  console.log(`[Approval Gate] Step ${stepIndex + 1} (${step.action}) is marked SENSITIVE.`);
  console.log(`[Approval Gate] Run ${runId} paused. Waiting for user approval (timeout: ${timeoutMs / 1000}s)...`);
  console.log(`========================================\n`);

  let screenshotUrl = '';
  try {
    const shotFilename = `gate_${runId}_step_${stepIndex}_${Date.now()}.png`;
    const shotPath = path.join(UPLOADS_DIR, shotFilename);
    await page.screenshot({ path: shotPath, fullPage: false });
    screenshotUrl = `/uploads/${shotFilename}`;
  } catch {}

  await updateRunStatus(runId, 'awaiting_approval', {
    stepIndex,
    totalSteps,
    action: step.action,
    screenshotUrl,
    pageUrl: page.url(),
    status: 'awaiting_approval',
  });

  const pollInterval = 1000;
  let elapsed = 0;

  while (elapsed < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollInterval));
    elapsed += pollInterval;

    try {
      const res = await pool.query('SELECT status FROM runs WHERE id = $1', [runId]);
      if (res.rows.length > 0) {
        const runStatus = res.rows[0].status;
        if (runStatus === 'running' || runStatus === 'approved') {
          console.log(`[Approval Gate] Run ${runId} was APPROVED by user. Resuming execution...`);
          return true;
        } else if (runStatus === 'cancelled' || runStatus === 'failed') {
          console.log(`[Approval Gate] Run ${runId} was REJECTED / CANCELLED by user.`);
          return false;
        }
      }
    } catch {}
  }

  console.warn(`[Approval Gate] Timeout exceeded (${timeoutMs / 1000}s). Auto-rejecting sensitive action.`);
  return false;
}

// Credentials Gate
async function waitForCredentialsGate(
  page: Page,
  runId: string,
  stepIndex: number,
  step: RecordedAction,
  timeoutMs = 120000
): Promise<string | null> {
  console.log(`\n========================================`);
  console.log(`[Credentials Gate] Password/Secret input required at step ${stepIndex + 1}.`);
  console.log(`[Credentials Gate] Run ${runId} paused awaiting credential input (timeout: ${timeoutMs / 1000}s)...`);
  console.log(`========================================\n`);

  await updateRunStatus(runId, 'awaiting_credentials', {
    stepIndex,
    action: step.action,
    fieldName: step.selectors?.name || 'Password',
    pageUrl: page.url(),
    status: 'awaiting_credentials',
  });

  const pollInterval = 1500;
  let elapsed = 0;

  while (elapsed < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollInterval));
    elapsed += pollInterval;

    try {
      const res = await pool.query('SELECT status, detail FROM runs WHERE id = $1', [runId]);
      if (res.rows.length > 0) {
        const run = res.rows[0];
        if (run.status === 'cancelled') return null;
        if (run.detail && run.detail.submittedCredential) {
          const val = run.detail.submittedCredential;
          // Clear credential from database
          const cleanDetail = { ...run.detail };
          delete cleanDetail.submittedCredential;
          await pool.query('UPDATE runs SET detail = $1 WHERE id = $2', [JSON.stringify(cleanDetail), runId]).catch(() => {});
          return val;
        }
      }
    } catch {}
  }

  console.warn(`[Credentials Gate] Timeout exceeded. No credentials provided.`);
  return null;
}

/**
 * Execute Workflow Run using Playwright Chromium.
 * Fully truth-enforcing: any step failure marks status as FAILED.
 * Updates database and diagnostics directly without HTTP self-calls.
 */
export async function executeWorkflowRun(
  workflowId: string,
  versionId: string,
  runId: string
): Promise<boolean> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const timestamp = Date.now();

  let currentStepIndex = 0;
  let currentAction = 'init';
  let currentStrategy = 'none';
  let currentTargetLabel = '';
  let downloadedFilePath: string | null = null;
  let isRunApproved = false;

  const failedRequests: Array<{ url: string; method: string; failure: string; isMainDocument: boolean }> = [];

  try {
    // 1. Fetch Workflow Version & Steps from Database directly
    const wfRes = await pool.query('SELECT * FROM workflows WHERE id = $1', [workflowId]);
    const workflowName = wfRes.rows[0]?.name || 'Automated Workflow';

    const verRes = await pool.query('SELECT * FROM workflow_versions WHERE id = $1', [versionId]);
    if (verRes.rows.length === 0) {
      throw new Error(`Workflow version ${versionId} not found`);
    }

    const rawSteps: RecordedAction[] = verRes.rows[0].steps || [];

    if (rawSteps.length === 0) {
      throw new Error(`Workflow version ${versionId} contains no recorded steps to execute`);
    }

    console.log(`[Executor] Starting execution for Run ${runId} (Workflow: ${workflowName}, Total Steps: ${rawSteps.length})`);

    // Broadcast running status directly to database & memory diagnostics
    await updateRunStatus(runId, 'running', {
      stepIndex: 0,
      totalSteps: rawSteps.length,
      status: 'running',
    });

    // 2. Launch Browser & Tracing (Deterministic Headless, Bundled Chromium)
    const isHeadless =
      process.env.HEADLESS === 'true' ||
      process.env.NODE_ENV === 'production' ||
      !!process.env.RENDER;
    const launchDiag = getPlaywrightDiagnostics();
    console.log(`[Executor] Launching Playwright Chromium (headless: ${isHeadless})...`, {
      playwrightVersion: launchDiag.version,
      executablePath: launchDiag.executablePath,
      playwrightBrowsersPath: launchDiag.browsersPath,
      executableExists: launchDiag.executableExists,
    });

    try {
      browser = await chromium.launch({
        headless: isHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      context = await browser.newContext({ acceptDownloads: true });
      await context.tracing.start({ screenshots: true, snapshots: true });
      page = await context.newPage();
    } catch (launchErr: any) {
      console.error('[Executor] Playwright Chromium launch failed:', {
        error: launchErr?.message || launchErr,
        diagnostics: launchDiag,
      });
      throw new Error(`Playwright Chromium could not be launched: ${launchErr?.message || launchErr}`);
    }

    // Network & Page Diagnostics
    page.on('requestfailed', (request) => {
      const failureText = request.failure()?.errorText || 'request failed';
      const isDoc = request.isNavigationRequest() || request.resourceType() === 'document';
      failedRequests.push({
        url: request.url(),
        method: request.method(),
        failure: failureText,
        isMainDocument: isDoc,
      });
      if (failedRequests.length > 50) failedRequests.shift();

      console.warn('[Playwright requestfailed]', {
        url: request.url(),
        method: request.method(),
        failure: failureText,
        isMainDocument: isDoc,
      });
    });

    page.on('console', (msg) => {
      console.log('[Playwright console]', msg.type(), msg.text());
    });

    page.on('pageerror', (error) => {
      console.error('[Playwright pageerror]', error);
    });

    // Global Download Handler: Automatically catch and save downloaded files
    page.on('download', async (download: any) => {
      try {
        const origFilename = download.suggestedFilename() || `result_download_${Date.now()}.pdf`;
        const destPath = path.join(DOWNLOADS_DIR, origFilename);
        await download.saveAs(destPath);
        downloadedFilePath = destPath;
        console.log(`[Executor Global Download Handler] Successfully saved file download to: ${destPath}`);
        await saveResultFileDirectly(runId, destPath);
      } catch (dErr) {
        console.error(`[Executor Global Download Error] Failed to save download:`, dErr);
      }
    });

    // New Tab & Popup Download Handler
    context.on('page', async (newPage: any) => {
      newPage.on('download', async (download: any) => {
        try {
          const origFilename = download.suggestedFilename() || `result_report_${Date.now()}.pdf`;
          const destPath = path.join(DOWNLOADS_DIR, origFilename);
          await download.saveAs(destPath);
          downloadedFilePath = destPath;
          console.log(`[Executor Popup Tab Download] Saved file to: ${destPath}`);
          await saveResultFileDirectly(runId, destPath);
        } catch {}
      });
    });

    // 3. Step Execution Loop
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
      if (step.pageUrl) console.log(`[Executor] targetUrl=${step.pageUrl}`);
      console.log(`[Executor] targetLabel=${currentTargetLabel}`);
      console.log(`========================================`);

      // Update current step progress directly to database & memory diagnostics
      await updateRunStatus(runId, 'running', {
        stepIndex: i,
        action: step.action,
        targetLabel: currentTargetLabel,
        pageUrl: page.url() || step.pageUrl || '',
        totalSteps: rawSteps.length,
        status: 'running',
      });

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

        try {
          const response = await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          console.log(`[Executor] Navigation successful. Status: ${response?.status()}, Current page: ${page.url()}`);
        } catch (navErr: any) {
          const currentUrl = page ? page.url() : 'unknown';
          let execPath = '';
          try {
            execPath = chromium.executablePath();
          } catch {}

          const mainDocFailure = failedRequests.find(
            (r) => r.isMainDocument && (r.url === targetUrl || r.url.startsWith(targetUrl))
          );

          let errorMsg = `Navigation failed: page.goto(${targetUrl}) failed: ${navErr?.message || navErr}`;
          if (mainDocFailure && mainDocFailure.failure.includes('ERR_BLOCKED_BY_CLIENT')) {
            errorMsg = `Navigation failed: Chromium rejected the main document request: ERR_BLOCKED_BY_CLIENT (${targetUrl})`;
          }

          console.error(`[Executor Navigation Failure Diagnostics]`, {
            targetUrl,
            message: navErr?.message,
            name: navErr?.name,
            stack: navErr?.stack,
            pageUrl: currentUrl,
            browserType: 'chromium',
            executablePath: execPath,
            headless: isHeadless,
            recentFailedRequests: failedRequests.slice(-5),
          });

          const enhancedNavErr = new Error(errorMsg);
          (enhancedNavErr as any).diagnostics = {
            url: targetUrl,
            pageUrl: currentUrl,
            browserType: 'chromium',
            executablePath: execPath,
            headless: isHeadless,
            failedRequests: failedRequests.slice(-5),
          };
          throw enhancedNavErr;
        }

        // Auto-dismiss cookie/consent dialogs if present (e.g. YouTube consent prompts)
        try {
          const consentLoc = page.locator(
            'button:has-text("Accept all"), button:has-text("Reject all"), button:has-text("I agree"), ytd-consent-bump-v2-lightbox button'
          );
          if (await consentLoc.count().catch(() => 0) > 0) {
            const firstConsent = consentLoc.first();
            if (await firstConsent.isVisible().catch(() => false)) {
              console.log('[Executor] Auto-dismissing cookie/consent overlay...');
              await firstConsent.click({ timeout: 2000 }).catch(() => {});
            }
          }
        } catch {}

      } else if (step.action === 'input' || step.action === 'change') {
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
          } else {
            inputValue = userCredential;
          }
        }

        if (inputValue) {
          try {
            await resolved.locator.fill(inputValue, { timeout: 8000 });
          } catch (fillErr: any) {
            await resolved.locator.click({ force: true, timeout: 4000 });
            await page.keyboard.type(inputValue, { delay: 40 });
          }

          // If this is a search input, submit search via Enter
          const isSearchInput = /search/i.test(step.selectors?.name || '') || /search/i.test(step.selectors?.css || '') || /search/i.test(resolved.strategy);
          if (isSearchInput && !isPasswordInput) {
            console.log('[Executor] Pressing Enter on search input to submit search...');
            await resolved.locator.press('Enter').catch(() => {});
            await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
          }

          // Verify field contains input value where possible
          if (!isPasswordInput) {
            const actualVal = await resolved.locator.inputValue({ timeout: 2000 }).catch(() => null);
            if (actualVal !== null && actualVal !== inputValue) {
              console.warn(`[Executor Input Note] Expected "${inputValue}", field currently contains "${actualVal}"`);
            }
          }
        }
        inputValue = '';
        console.log(`[Executor] Input successful`);

      } else if (step.action === 'click' || step.action === 'submit') {
        if (step.pageUrl) {
          const currentUrl = page.url();
          if (currentUrl === 'about:blank') {
            console.log(`[Executor] Blank page detected. Navigating to step page: ${step.pageUrl}`);
            await page.goto(step.pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          }
        }

        let resolved: ResolvedTarget;
        try {
          resolved = await resolveInteractiveTarget(page, step, 10000);
        } catch (firstResolveErr) {
          if (step.pageUrl && page.url() !== step.pageUrl && !page.url().includes(new URL(step.pageUrl).pathname)) {
            console.log(`[Executor] Target not found on ${page.url()}. Navigating to step pageUrl: ${step.pageUrl}`);
            await page.goto(step.pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            resolved = await resolveInteractiveTarget(page, step, 8000);
          } else {
            throw firstResolveErr;
          }
        }

        currentStrategy = resolved.strategy;
        console.log(`[Executor] Element resolved strategy=${resolved.strategy} matches=${resolved.matches} desc="${resolved.description}"`);

        try {
          await resolved.locator.click({ timeout: 10000 });
        } catch (clickErr: any) {
          console.warn(`[Executor] Normal click timed out, attempting force click...`);
          await resolved.locator.click({ force: true, timeout: 5000 });
        }
        console.log(`[Executor] Click successful`);

      } else {
        console.log(`[Executor] Custom action "${step.action}" performed.`);
      }

      // Safe settling delay (400ms) between actions for DOM updates & page responsiveness
      await page.waitForTimeout(400);
    }

    // Stop Tracing on Success
    if (context) {
      await context.tracing.stop().catch(() => {});
    }

    let downloadFilename: string | null = null;
    if (downloadedFilePath) {
      downloadFilename = await saveResultFileDirectly(runId, downloadedFilePath);
    }

    // Mark Run Completed ONLY because all steps executed with real success
    await updateRunStatus(runId, 'completed', {
      downloadedFilePath,
      downloadFilename,
      downloadUrl: downloadFilename ? `/api/runs/${runId}/download` : null,
      previewUrl: downloadFilename ? `/api/runs/${runId}/preview` : null,
      totalSteps: rawSteps.length,
      stepIndex: rawSteps.length - 1,
      pageUrl: page.url(),
      status: 'completed',
    });

    console.log(`\n========================================`);
    console.log(`[Executor] Run ${runId} COMPLETED SUCCESSFULLY! All ${rawSteps.length} steps executed.`);
    console.log(`========================================\n`);
    return true;

  } catch (error: any) {
    const rawErrorMessage = error?.message || String(error);
    console.error(`\n[Executor Error] Run ${runId} FAILED at step ${currentStepIndex + 1} (${currentAction}):`, rawErrorMessage);

    // Redact tokens/passwords
    const safeErrorMessage = rawErrorMessage
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/password=[^&\s]+/gi, 'password=[REDACTED]');

    // Check if run was cancelled by user
    let isCancelled = false;
    try {
      const checkRes = await pool.query('SELECT status FROM runs WHERE id = $1', [runId]);
      if (checkRes.rows[0]?.status === 'cancelled') isCancelled = true;
    } catch {}

    if (!isCancelled) {
      let screenshotUrl: string | null = null;
      let traceUrl: string | null = null;

      try {
        if (page && !page.isClosed()) {
          const screenshotPath = path.join(FAILURES_DIR, `failure_${runId}_${timestamp}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
          if (fs.existsSync(screenshotPath)) {
            screenshotUrl = screenshotPath;
            console.log(`[Executor Failure Artifact] Screenshot saved: ${screenshotPath}`);
          }
        }
      } catch (sErr) {
        console.warn(`[Executor] Could not capture failure screenshot:`, sErr);
      }

      try {
        if (context) {
          const tracePath = path.join(FAILURES_DIR, `trace_${runId}_${timestamp}.zip`);
          await context.tracing.stop({ path: tracePath }).catch(() => {});
          if (fs.existsSync(tracePath)) {
            traceUrl = tracePath;
            console.log(`[Executor Failure Artifact] Playwright trace saved: ${tracePath}`);
          }
        }
      } catch (tErr) {
        console.warn(`[Executor] Could not capture Playwright trace:`, tErr);
      }

      // Mark Run as FAILED directly in database & diagnostics
      await updateRunStatus(runId, 'failed', {
        failedStepIndex: currentStepIndex,
        stepIndex: currentStepIndex,
        action: currentAction,
        targetLabel: currentTargetLabel,
        selectorStrategy: currentStrategy,
        pageUrl: page && !page.isClosed() ? page.url() : '',
        status: 'failed',
        error: safeErrorMessage,
        diagnostics: (error as any).diagnostics || null,
        recentFailedRequests: failedRequests.slice(-5),
        screenshotUrl,
        traceUrl,
      }, safeErrorMessage);
    }

    return false;

  } finally {
    if (context) {
      await context.close().catch((err) => console.error('[Executor Cleanup] Error closing context:', err));
    }
    if (browser) {
      await browser.close().catch((err) => console.error('[Executor Cleanup] Error closing browser:', err));
    }
    console.log(`[Executor] Execution lifecycle ended for run ${runId}.`);
  }
}
