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

// Generate CSS selector fallback
function getCssSelector(el: HTMLElement): string {
  if (el.id) {
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
      if (v) return v;
    }
  } catch (e) {
    // Ignore invalid URLs
  }
  return undefined;
}

// Extract selector strategies
function extractSelectors(el: HTMLElement): SelectorBundle {
  const role = el.getAttribute('role') || el.tagName.toLowerCase();
  const name = el.getAttribute('aria-label') ||
               el.getAttribute('title') ||
               el.getAttribute('alt') ||
               el.getAttribute('placeholder') ||
               el.textContent?.trim().slice(0, 50);

  const text = el.textContent?.trim().slice(0, 100);
  const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || undefined;
  const css = getCssSelector(el);

  const anchorEl = (el.tagName.toLowerCase() === 'a' ? el : el.closest('a')) as HTMLAnchorElement | null;
  const videoId = extractStableId(anchorEl);
  const inputType = (el instanceof HTMLInputElement) ? el.type.toLowerCase() : undefined;

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

// Check if form contains sensitive input fields (passwords or currency/payment data)
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

// Event Listeners
function setupRecordingListeners() {
  // Click Listener
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target) return;

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
    const target = e.target as HTMLElement;
    if (!target) return;

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

// Initialize content script
setupRecordingListeners();
