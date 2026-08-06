"use strict";
// Generate CSS selector fallback
function getCssSelector(el) {
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
// Extract selector strategies
function extractSelectors(el) {
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name = el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('alt') ||
        el.getAttribute('placeholder') ||
        el.textContent?.trim().slice(0, 50);
    const text = el.textContent?.trim().slice(0, 100);
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || undefined;
    const css = getCssSelector(el);
    return {
        role: role || undefined,
        name: name || undefined,
        text: text || undefined,
        testId: testId || undefined,
        css: css || undefined,
    };
}
// Save recorded action to chrome.storage.local
async function recordAction(action) {
    try {
        const data = await chrome.storage.local.get(['isRecording', 'recordingQueue']);
        if (!data.isRecording)
            return;
        const queue = data.recordingQueue || [];
        queue.push(action);
        await chrome.storage.local.set({ recordingQueue: queue });
        console.log('[TaskForge Recorder] Action recorded:', action);
    }
    catch (err) {
        console.error('[TaskForge Recorder] Error saving recorded action:', err);
    }
}
// Check if element is password field
function isPasswordField(el) {
    if (el instanceof HTMLInputElement) {
        return el.type.toLowerCase() === 'password';
    }
    return false;
}
// Event Listeners
function setupRecordingListeners() {
    // Click Listener
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target)
            return;
        const selectors = extractSelectors(target);
        recordAction({
            action: 'click',
            timestamp: Date.now(),
            selectors,
            pageUrl: window.location.href,
        });
    }, true);
    // Input / Change Listener
    const handleInputEvent = (e) => {
        const target = e.target;
        if (!target)
            return;
        if (target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement) {
            let val = target.value;
            if (isPasswordField(target)) {
                val = '[REDACTED]';
            }
            else if (target instanceof HTMLInputElement && target.type === 'checkbox') {
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
    document.addEventListener('input', (e) => {
        // Debounce or record on blur/change to avoid high frequency, but record input
        if (e.target instanceof HTMLInputElement && isPasswordField(e.target)) {
            handleInputEvent(e);
        }
    }, true);
    // Form Submit Listener
    document.addEventListener('submit', (e) => {
        const target = e.target;
        if (!target)
            return;
        const selectors = extractSelectors(target);
        recordAction({
            action: 'submit',
            timestamp: Date.now(),
            selectors,
            pageUrl: window.location.href,
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
