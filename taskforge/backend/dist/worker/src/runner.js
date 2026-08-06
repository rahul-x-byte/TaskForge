import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
// Environment variables with fallbacks
const SITE_URL = process.env.TEST_SITE_URL || 'http://localhost:3001';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'password123';
const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
const FAILURES_DIR = path.resolve(process.cwd(), 'failures');
// Ensure directories exist
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(FAILURES_DIR)) {
    fs.mkdirSync(FAILURES_DIR, { recursive: true });
}
function getFormattedDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
export async function runAutomation() {
    let browser = null;
    let context = null;
    let page = null;
    const timestamp = Date.now();
    let currentStep = 'Initialization';
    try {
        // Step 1: Launch Chromium & Isolated Context
        currentStep = 'Step 1: Launch isolated browser context';
        console.log(`[Runner] ${currentStep}`);
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ acceptDownloads: true });
        // Start Playwright Tracing
        await context.tracing.start({ screenshots: true, snapshots: true });
        page = await context.newPage();
        // Step 2: Navigate to login page
        currentStep = 'Step 2: Navigate to login page';
        console.log(`[Runner] ${currentStep}`);
        await page.goto(`${SITE_URL}/login`, { waitUntil: 'networkidle' });
        // Step 3: Fill credentials & submit login
        currentStep = 'Step 3: Fill credentials & submit login';
        console.log(`[Runner] ${currentStep}`);
        if (!USERNAME || !PASSWORD) {
            throw new Error('TEST_USERNAME or TEST_PASSWORD environment variable is missing.');
        }
        await page.fill('#username', USERNAME);
        await page.fill('#password', PASSWORD);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle' }),
            page.click('#login-submit'),
        ]);
        // Step 4: Navigate to reports page
        currentStep = 'Step 4: Navigate to reports page';
        console.log(`[Runner] ${currentStep}`);
        if (!page.url().includes('/reports')) {
            await page.goto(`${SITE_URL}/reports`, { waitUntil: 'networkidle' });
        }
        // Step 5: Click Download Report & wait for download event
        currentStep = 'Step 5: Trigger report download';
        console.log(`[Runner] ${currentStep}`);
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.click('#download-report-btn'),
        ]);
        // Step 6: Save downloaded file with today's date filename
        currentStep = 'Step 6: Save downloaded file';
        console.log(`[Runner] ${currentStep}`);
        const dateStr = getFormattedDate();
        const targetFilename = `attendance_report_${dateStr}.csv`;
        const targetFilePath = path.join(DOWNLOADS_DIR, targetFilename);
        await download.saveAs(targetFilePath);
        console.log(`[Runner] Report downloaded successfully: ${targetFilePath}`);
        // Stop tracing on success (optional/clean)
        await context.tracing.stop();
        return true;
    }
    catch (error) {
        console.error(`[Runner Error] Failed during step: "${currentStep}"`);
        console.error(`[Runner Error] Message:`, error?.message || error);
        // Save Screenshot and Trace on failure
        if (page && !page.isClosed()) {
            try {
                const screenshotPath = path.join(FAILURES_DIR, `${timestamp}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`[Runner Failure] Screenshot saved to: ${screenshotPath}`);
            }
            catch (screenErr) {
                console.error(`[Runner Failure] Could not save screenshot:`, screenErr);
            }
        }
        if (context) {
            try {
                const tracePath = path.join(FAILURES_DIR, `${timestamp}.zip`);
                await context.tracing.stop({ path: tracePath });
                console.log(`[Runner Failure] Trace zip saved to: ${tracePath}`);
            }
            catch (traceErr) {
                console.error(`[Runner Failure] Could not save trace zip:`, traceErr);
            }
        }
        return false;
    }
    finally {
        // Step 7: Clean context and browser close
        if (context) {
            try {
                await context.close();
            }
            catch (ctxErr) {
                console.error('[Runner Cleanup] Error closing context:', ctxErr);
            }
        }
        if (browser) {
            try {
                await browser.close();
            }
            catch (brErr) {
                console.error('[Runner Cleanup] Error closing browser:', brErr);
            }
        }
        console.log('[Runner] Browser context closed cleanly.');
    }
}
// Execute directly if run via CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('runner.ts')) {
    runAutomation().then((success) => {
        if (!success) {
            process.exit(1);
        }
    });
}
