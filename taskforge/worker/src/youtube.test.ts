import playwright from 'playwright';

const { chromium } = playwright;

export async function runYouTubeAutomationTest(): Promise<boolean> {
  const isHeadless =
    process.env.HEADLESS === 'true' ||
    process.env.NODE_ENV === 'production' ||
    !!process.env.RENDER;

  console.log(`[YouTube Test] Launching Playwright Chromium (headless: ${isHeadless})...`);
  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  page.on('requestfailed', (request) => {
    console.warn('[Playwright requestfailed]', {
      url: request.url().slice(0, 100),
      failure: request.failure()?.errorText,
    });
  });

  try {
    // 1. Navigate to YouTube
    console.log('[YouTube Test] Step 1: Navigating to https://www.youtube.com/...');
    const response = await page.goto('https://www.youtube.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    console.log(`[YouTube Test] Navigation completed. HTTP Status: ${response?.status()}, URL: ${page.url()}`);

    // Auto-dismiss cookie/consent dialog if present
    try {
      const consentLoc = page.locator(
        'button:has-text("Accept all"), button:has-text("Reject all"), button:has-text("I agree"), ytd-consent-bump-v2-lightbox button'
      );
      if (await consentLoc.count().catch(() => 0) > 0) {
        const firstConsent = consentLoc.first();
        if (await firstConsent.isVisible().catch(() => false)) {
          console.log('[YouTube Test] Auto-dismissing cookie/consent dialog...');
          await firstConsent.click({ timeout: 2000 }).catch(() => {});
        }
      }
    } catch {}

    // 2. Find the search input using resilient multi-strategy selectors
    console.log('[YouTube Test] Step 2: Locating search input...');
    const searchSelectors = [
      'input[name="search_query"]',
      'yt-searchbox input:not([type="file"])',
      'input#search',
      'input[type="search"]',
      'input[placeholder*="Search" i]',
      '[role="searchbox"]',
    ];

    let searchInput = null;
    for (const selector of searchSelectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const candidate = locator.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          searchInput = candidate;
          console.log(`[YouTube Test] Found visible search input via selector: "${selector}"`);
          break;
        }
      }
      if (searchInput) break;
    }

    if (!searchInput) {
      throw new Error('Failed to locate a visible, interactive search input on YouTube.');
    }

    await searchInput.click();
    console.log('[YouTube Test] Search input clicked successfully.');

    // 3. Enter "tamil songs" and 4. Submit / search
    console.log('[YouTube Test] Step 3: Entering query "tamil songs"...');
    await searchInput.fill('tamil songs');

    console.log('[YouTube Test] Step 4: Submitting search via Enter key...');
    await Promise.all([
      page.waitForURL((url) => url.pathname.includes('/results'), { timeout: 15000 }).catch(() => {}),
      searchInput.press('Enter'),
    ]);

    // 5. Verify search results page loaded
    console.log(`[YouTube Test] Step 5: Verifying search results page: ${page.url()}`);
    if (!page.url().includes('/results')) {
      console.log('[YouTube Test] Explicitly waiting for search results URL update...');
      await page.waitForURL(/results/i, { timeout: 10000 });
    }
    console.log('[YouTube Test] Search results page successfully loaded.');

    // 6. Locate first valid video result
    console.log('[YouTube Test] Step 6: Locating first video result in search list...');
    const videoSelectors = [
      'ytd-video-renderer a#video-title',
      '#contents ytd-video-renderer a#video-title',
      'ytd-video-renderer a#thumbnail',
      'a#video-title',
    ];

    let videoLink = null;
    let videoTitle = '';
    for (const selector of videoSelectors) {
      const locator = page.locator(selector);
      try {
        await locator.first().waitFor({ state: 'visible', timeout: 10000 });
        const count = await locator.count();
        if (count > 0) {
          videoLink = locator.first();
          videoTitle = (await videoLink.getAttribute('title').catch(() => '')) ||
                       (await videoLink.innerText().catch(() => '')) ||
                       'Video Result';
          console.log(`[YouTube Test] Found video link via "${selector}": "${videoTitle.trim()}"`);
          break;
        }
      } catch {}
    }

    if (!videoLink) {
      throw new Error('Failed to locate any valid video results on the search results page.');
    }

    // 7. Click the first valid video result and verify navigation to watch page
    console.log(`[YouTube Test] Step 7: Clicking video result: "${videoTitle.trim()}"...`);
    await Promise.all([
      page.waitForURL((url) => url.pathname.includes('/watch') || url.pathname.includes('/shorts/'), { timeout: 15000 }).catch(() => {}),
      videoLink.click({ timeout: 10000 }),
    ]);

    const finalUrl = page.url();
    console.log(`[YouTube Test] Video page loaded! Final URL: ${finalUrl}`);
    if (!finalUrl.includes('/watch') && !finalUrl.includes('/shorts/')) {
      throw new Error(`Expected watch page URL, but current URL is: ${finalUrl}`);
    }

    console.log('[YouTube Test] ALL 7 STEPS COMPLETED DETERMINISTICALLY WITH REAL PLAYWRIGHT CHROMIUM!');
    return true;

  } catch (error: any) {
    console.error('[YouTube Test Error] Automation test failed:', error?.message || error);
    return false;

  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    console.log('[YouTube Test] Browser closed cleanly.');
  }
}

// Direct execution
if (process.argv[1]?.includes('youtube.test')) {
  runYouTubeAutomationTest().then((passed) => {
    process.exit(passed ? 0 : 1);
  });
}
