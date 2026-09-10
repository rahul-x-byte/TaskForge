interface SelectorBundle {
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  css?: string;
  videoId?: string;
  inputType?: string;
}

interface RecordedAction {
  action: 'click' | 'input' | 'change' | 'submit' | 'navigate';
  timestamp: number;
  selectors: SelectorBundle;
  value?: string;
  pageUrl: string;
  isSensitive?: boolean;
}

// The dashboard page cannot use chrome.runtime directly. This small bridge
// wakes the extension as soon as it queues a desktop run.
window.addEventListener('message', (event: MessageEvent) => {
  const hostname = window.location.hostname;
  const isTaskForgeDashboard = hostname === 'task-forge-phi-six.vercel.app' ||
    hostname === 'localhost' || hostname === '127.0.0.1';
  if (
    !isTaskForgeDashboard ||
    event.source !== window ||
    event.data?.source !== 'taskforge-dashboard' ||
    event.data?.type !== 'DESKTOP_RUN_QUEUED'
  ) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'CHECK_PENDING_DESKTOP_RUNS' });
});

// Strictly sanitize values to ensure SelectorBundle properties are non-boolean strings
function sanitizeString(val: unknown): string | undefined {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.length > 0 && trimmed !== 'true' && trimmed !== 'false') {
      return trimmed;
    }
  }
  return undefined;
}

// Generate CSS selector fallback
function getCssSelector(el: HTMLElement): string {
  if (el.id && !/^\d/.test(el.id)) {
    return `#${CSS.escape(el.id)}`;
  }

  const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy');
  if (testId) {
    return `[data-testid="${testId}"]`;
  }

  if (el === document.body) {
    return 'body';
  }

  const parent = el.parentElement;
  if (!parent) {
    return el.tagName.toLowerCase();
  }

  const siblings = Array.from(parent.children).filter(child => child.tagName === el.tagName);
  const index = siblings.indexOf(el) + 1;
  const tagName = el.tagName.toLowerCase();

  const parentSelector = getCssSelector(parent);
  return `${parentSelector} > ${tagName}${siblings.length > 1 ? `:nth-of-type(${index})` : ''}`;
}

// Extract site-specific stable identifier (e.g. YouTube video ID) from anchor elements
function extractStableId(anchorEl: HTMLAnchorElement | null): string | undefined {
  if (!anchorEl || !anchorEl.href) return undefined;
  try {
    const url = new URL(anchorEl.href, window.location.origin);
    const hostname = url.hostname.toLowerCase();

    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      const v = url.searchParams.get('v');
      if (v && v !== 'true' && v !== 'false') return v;
      const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch && shortsMatch[1]) return shortsMatch[1];
    }
  } catch (e) {}
  return undefined;
}

// Climb DOM from child elements (e.g. <img>, <span>, <path>) to the closest interactive element
function getInteractiveTarget(target: HTMLElement): HTMLElement {
  if (!target || target === document.body || target === document.documentElement) {
    return target;
  }

  const tag = target.tagName.toLowerCase();
  if (['button', 'input', 'textarea', 'select', 'option'].includes(tag)) {
    return target;
  }

  const interactiveAncestor = target.closest(
    'button, a[href], input, textarea, select, option, ' +
    '[role="button"], [role="link"], [role="combobox"], [role="checkbox"], [role="radio"], [role="tab"], ' +
    '[role="menuitem"], [contenteditable="true"], yt-formatted-string[role="link"]'
  ) as HTMLElement | null;

  if (interactiveAncestor && interactiveAncestor !== document.body && interactiveAncestor !== document.documentElement) {
    return interactiveAncestor;
  }

  // YouTube specific: if clicked inside video renderer item, climb to video title link
  const ytVideoItem = target.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer');
  if (ytVideoItem) {
    const titleAnchor = ytVideoItem.querySelector('a#video-title-link, a#video-title, a[href*="/watch?v="]') as HTMLElement | null;
    if (titleAnchor) return titleAnchor;
  }

  return target;
}

// Detect YouTube searchbox
function isYouTubeSearchInput(el: HTMLElement): boolean {
  if (window.location.hostname.includes('youtube.com')) {
    if (
      el.id === 'search' ||
      el.getAttribute('name') === 'search_query' ||
      el.closest('yt-searchbox, #search-form, #search-input') !== null
    ) {
      return true;
    }
  }
  return false;
}

// Extract selector strategies (strict string values - no booleans)
function extractSelectors(el: HTMLElement): SelectorBundle {
  // 1. Special Handling: YouTube Search Input
  if (isYouTubeSearchInput(el)) {
    return {
      role: 'combobox',
      name: 'Search',
      css: 'input#search, yt-searchbox input, [name="search_query"]',
      inputType: 'text',
    };
  }

  const anchorEl = (el.tagName.toLowerCase() === 'a' ? el : el.closest('a')) as HTMLAnchorElement | null;
  const videoId = extractStableId(anchorEl);

  let role = sanitizeString(el.getAttribute('role'));
  if (!role && ['button', 'a', 'input', 'textarea', 'select'].includes(el.tagName.toLowerCase())) {
    role = el.tagName.toLowerCase() === 'a' ? 'link' : el.tagName.toLowerCase();
  }

  // Extract accessible name
  let name = sanitizeString(el.getAttribute('aria-label')) ||
             sanitizeString(el.getAttribute('title')) ||
             sanitizeString(el.getAttribute('alt')) ||
             sanitizeString(el.getAttribute('placeholder'));

  if (!name && el.textContent) {
    const textContent = el.textContent.trim().slice(0, 60);
    name = sanitizeString(textContent);
  }

  // YouTube specific: If video anchor, extract video title from renderer
  if (videoId && (!name || name.length < 3)) {
    const parentRenderer = el.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer');
    const titleEl = parentRenderer?.querySelector('#video-title');
    if (titleEl) {
      name = sanitizeString(titleEl.getAttribute('title')) || sanitizeString(titleEl.textContent);
    }
  }

  const text = sanitizeString(el.textContent?.trim().slice(0, 100));
  const testId = sanitizeString(el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy'));

  let css = getCssSelector(el);
  if (videoId && anchorEl) {
    css = `a#video-title, a[href*="${videoId}"]`;
  }

  const inputType = (el instanceof HTMLInputElement) ? sanitizeString(el.type.toLowerCase()) : undefined;

  return {
    role: role || undefined,
    name: name || undefined,
    text: text || undefined,
    testId: testId || undefined,
    css: css || undefined,
    videoId: videoId || undefined,
    inputType: inputType || undefined,
  };
}

// Check if form contains sensitive input fields
function formContainsSensitiveInput(formEl: HTMLElement): boolean {
  try {
    const inputs = Array.from(formEl.querySelectorAll('input, select, textarea'));
    return inputs.some((input) => {
      if (input instanceof HTMLInputElement && input.type.toLowerCase() === 'password') {
        return true;
      }
      const attrString = `${input.getAttribute('name') || ''} ${input.id} ${input.getAttribute('autocomplete') || ''} ${input.getAttribute('placeholder') || ''}`.toLowerCase();
      const sensitiveKeywords = ['card', 'cvv', 'cvc', 'pay', 'price', 'amount', 'credit', 'billing'];
      return sensitiveKeywords.some((keyword) => attrString.includes(keyword));
    });
  } catch (e) {
    return false;
  }
}

// Save recorded action to chrome.storage.local
async function recordAction(action: RecordedAction) {
  try {
    const data = await chrome.storage.local.get(['isRecording', 'recordingQueue']);
    if (!data.isRecording) return;

    const queue: RecordedAction[] = data.recordingQueue || [];

    // Auto-inject initial navigation step if starting recording mid-session
    if (queue.length === 0 && action.action !== 'navigate') {
      queue.push({
        action: 'navigate',
        timestamp: action.timestamp - 1,
        selectors: { css: 'window' },
        value: window.location.href,
        pageUrl: window.location.href,
      });
    }

    // De-duplicate rapid input typing into the same element
    if (action.action === 'input' && queue.length > 0) {
      const last = queue[queue.length - 1];
      if (last.action === 'input' && last.selectors.css === action.selectors.css) {
        last.value = action.value;
        last.timestamp = action.timestamp;
        await chrome.storage.local.set({ recordingQueue: queue });
        console.log('[TaskForge Recorder] Updated input value:', action.value);
        return;
      }
    }

    queue.push(action);
    await chrome.storage.local.set({ recordingQueue: queue });
    console.log('[TaskForge Recorder] Action recorded:', action);
  } catch (err) {
    console.error('[TaskForge Recorder] Error saving recorded action:', err);
  }
}

// Check if element is password field
function isPasswordField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    return el.type.toLowerCase() === 'password';
  }
  return false;
}

// Event Listeners for Recording
function setupRecordingListeners() {
  // Click Listener (promotes to interactive ancestor e.g. <a> instead of <img>)
  document.addEventListener('click', (e) => {
    let target = e.target as HTMLElement;
    if (!target) return;

    target = getInteractiveTarget(target);
    const selectors = extractSelectors(target);
    recordAction({
      action: 'click',
      timestamp: Date.now(),
      selectors,
      pageUrl: window.location.href,
    });
  }, true);

  // Input / Change Listener
  const handleInputEvent = (e: Event) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      let val = target.value;
      if (isPasswordField(target)) {
        val = '[REDACTED]';
      } else if (target instanceof HTMLInputElement && target.type === 'checkbox') {
        val = target.checked ? 'true' : 'false';
      }

      const selectors = extractSelectors(target);
      recordAction({
        action: 'input',
        timestamp: Date.now(),
        selectors,
        value: val,
        pageUrl: window.location.href,
      });
    }
  };

  document.addEventListener('change', handleInputEvent, true);
  document.addEventListener('input', handleInputEvent, true);
  document.addEventListener('blur', handleInputEvent, true);

  // Form Submit Listener
  document.addEventListener('submit', (e) => {
    let target = e.target as HTMLElement;
    if (!target) return;

    target = getInteractiveTarget(target);
    const selectors = extractSelectors(target);
    const isSensitive = formContainsSensitiveInput(target);
    recordAction({
      action: 'submit',
      timestamp: Date.now(),
      selectors,
      pageUrl: window.location.href,
      isSensitive,
    });
  }, true);

  // SPA Navigation Overrides
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    recordAction({
      action: 'navigate',
      timestamp: Date.now(),
      selectors: { css: 'window' },
      value: window.location.href,
      pageUrl: window.location.href,
    });
  };

  window.addEventListener('popstate', () => {
    recordAction({
      action: 'navigate',
      timestamp: Date.now(),
      selectors: { css: 'window' },
      value: window.location.href,
      pageUrl: window.location.href,
    });
  });
}

// In-browser Step Execution Selector Engine (Consistent with worker resolution)
// Order: videoId -> role + name -> testId -> stable CSS -> visible text. NEVER returns body.
function findElementBySelectors(selectors: SelectorBundle, action?: string): HTMLElement | null {
  if (!selectors) return null;

  const isInputAction = action === 'input' || action === 'change';
  const isClickAction = action === 'click' || action === 'submit';

  function validateTarget(el: HTMLElement | null): HTMLElement | null {
    if (!el || el === document.body || el === document.documentElement) return null;

    if (isInputAction) {
      const tag = el.tagName.toLowerCase();
      if (!['input', 'textarea', 'select'].includes(tag) && !el.isContentEditable) {
        const inner = el.querySelector('input, textarea, select, [contenteditable="true"]') as HTMLElement | null;
        if (inner) return inner;
      }
    }

    if (isClickAction) {
      el = getInteractiveTarget(el);
    }

    return el;
  }

  // 1. Video ID
  if (selectors.videoId && typeof selectors.videoId === 'string' && selectors.videoId !== 'true' && selectors.videoId !== 'false') {
    try {
      const el = document.querySelector(`a[href*="v=${selectors.videoId}"], a[href*="/shorts/${selectors.videoId}"], a[href*="${selectors.videoId}"]`) as HTMLElement;
      const valid = validateTarget(el);
      if (valid) return valid;
    } catch {}
  }

  // 2. Role + Accessible Name
  if (selectors.role && selectors.name && typeof selectors.role === 'string' && typeof selectors.name === 'string' && selectors.name !== 'true' && selectors.name !== 'false') {
    try {
      const candidates = Array.from(document.querySelectorAll(`[role="${selectors.role}"], button, a, input, textarea, select`)) as HTMLElement[];
      for (const cand of candidates) {
        const candRole = cand.getAttribute('role') || cand.tagName.toLowerCase();
        const candName = cand.getAttribute('aria-label') || cand.getAttribute('title') || cand.getAttribute('placeholder') || cand.textContent?.trim();
        if (candRole.toLowerCase() === selectors.role.toLowerCase() && candName && candName.toLowerCase().includes(selectors.name.toLowerCase())) {
          const valid = validateTarget(cand);
          if (valid) return valid;
        }
      }
    } catch {}
  }

  // 3. TestID
  if (selectors.testId && typeof selectors.testId === 'string' && selectors.testId !== 'true' && selectors.testId !== 'false') {
    try {
      const el = document.querySelector(`[data-testid="${selectors.testId}"], [data-test-id="${selectors.testId}"], [data-cy="${selectors.testId}"]`) as HTMLElement;
      const valid = validateTarget(el);
      if (valid) return valid;
    } catch {}
  }

  // 4. Stable CSS (reject body, html, window)
  if (selectors.css && typeof selectors.css === 'string' && selectors.css !== 'true' && selectors.css !== 'false') {
    const cleanCss = selectors.css.trim();
    if (cleanCss && cleanCss !== 'body' && cleanCss !== 'html' && cleanCss !== 'window') {
      try {
        const el = document.querySelector(cleanCss) as HTMLElement;
        const valid = validateTarget(el);
        if (valid) return valid;
      } catch {}
    }
  }

  // 5. Visible Text
  if (selectors.text && typeof selectors.text === 'string' && selectors.text !== 'true' && selectors.text !== 'false' && selectors.text.length < 100) {
    try {
      const xpath = `//*[contains(text(), '${selectors.text.replace(/'/g, "\\'")}')]`;
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (result.singleNodeValue) {
        const valid = validateTarget(result.singleNodeValue as HTMLElement);
        if (valid) return valid;
      }
    } catch {}
  }

  return null;
}

function highlightElement(el: HTMLElement) {
  try {
    const origOutline = el.style.outline;
    const origBoxShadow = el.style.boxShadow;
    el.style.outline = '2px solid #38bdf8';
    el.style.boxShadow = '0 0 12px rgba(56, 189, 248, 0.8)';
    setTimeout(() => {
      el.style.outline = origOutline;
      el.style.boxShadow = origBoxShadow;
    }, 600);
  } catch (e) {}
}

// In-browser Step Execution Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_STEP') {
    const step: RecordedAction = message.step;
    if (!step) {
      sendResponse({ status: 'error', error: 'No step provided' });
      return true;
    }

    try {
      if (step.action === 'navigate') {
        const targetUrl = step.value || step.pageUrl;
        if (targetUrl && targetUrl !== window.location.href) {
          window.location.href = targetUrl;
        }
        sendResponse({ status: 'success' });
        return true;
      }

      const el = findElementBySelectors(step.selectors, step.action);
      if (!el) {
        console.warn('[TaskForge Execution] Element not found for step:', step);
        sendResponse({
          status: 'element_not_found',
          error: `Could not find target element for action "${step.action}"`,
          selectors: step.selectors,
        });
        return true;
      }

      highlightElement(el);

      if (step.action === 'click' || step.action === 'submit') {
        el.click();
        sendResponse({ status: 'success' });
      } else if (step.action === 'input' || step.action === 'change') {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          el.focus();
          el.value = step.value || '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        } else if (el.isContentEditable) {
          el.focus();
          el.textContent = step.value || '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        sendResponse({ status: 'success' });
      } else {
        sendResponse({ status: 'success' });
      }
    } catch (err: any) {
      console.error('[TaskForge Execution Error]', err);
      sendResponse({ status: 'error', error: err?.message || 'Execution error' });
    }
    return true;
  }
});

// Initialize content script recording listeners
setupRecordingListeners();
