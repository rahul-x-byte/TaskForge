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
// Extract site-specific stable identifier (e.g. YouTube video ID) from anchor elements
function extractStableId(anchorEl) {
    if (!anchorEl || !anchorEl.href)
        return undefined;
    try {
        const url = new URL(anchorEl.href, window.location.origin);
        const hostname = url.hostname.toLowerCase();
        if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
            const v = url.searchParams.get('v');
            if (v)
                return v;
        }
    }
    catch (e) {
        // Ignore invalid URLs
    }
    return undefined;
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
    const anchorEl = (el.tagName.toLowerCase() === 'a' ? el : el.closest('a'));
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
function formContainsSensitiveInput(formEl) {
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
    }
    catch (e) {
        return false;
    }
}
// Save recorded action to chrome.storage.local
async function recordAction(action) {
    try {
        const data = await chrome.storage.local.get(['isRecording', 'recordingQueue']);
        if (!data.isRecording)
            return;
        const queue = data.recordingQueue || [];
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
    document.addEventListener('input', handleInputEvent, true);
    document.addEventListener('blur', handleInputEvent, true);
    // Form Submit Listener
    document.addEventListener('submit', (e) => {
        const target = e.target;
        if (!target)
            return;
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
// In-browser Step Execution Engine
function findElementBySelectors(selectors) {
    if (!selectors)
        return null;
    if (selectors.css && selectors.css !== 'body' && selectors.css !== 'html') {
        try {
            const el = document.querySelector(selectors.css);
            if (el)
                return el;
        }
        catch (e) { }
    }
    if (selectors.videoId) {
        try {
            const el = document.querySelector(`a[href*="${selectors.videoId}"]`);
            if (el)
                return el;
        }
        catch (e) { }
    }
    if (selectors.testId) {
        try {
            const el = document.querySelector(`[data-testid="${selectors.testId}"]`);
            if (el)
                return el;
        }
        catch (e) { }
    }
    if (selectors.text && selectors.text.length < 100) {
        try {
            const xpath = `//*[contains(text(), '${selectors.text.replace(/'/g, "\\'")}')]`;
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            if (result.singleNodeValue)
                return result.singleNodeValue;
        }
        catch (e) { }
    }
    return null;
}
function highlightElement(el) {
    try {
        const origOutline = el.style.outline;
        const origBoxShadow = el.style.boxShadow;
        el.style.outline = '2px solid #38bdf8';
        el.style.boxShadow = '0 0 12px rgba(56, 189, 248, 0.8)';
        setTimeout(() => {
            el.style.outline = origOutline;
            el.style.boxShadow = origBoxShadow;
        }, 600);
    }
    catch (e) { }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXECUTE_STEP') {
        const step = message.step;
        if (!step) {
            sendResponse({ status: 'error', error: 'No step provided' });
            return true;
        }
        if (step.action === 'navigate') {
            const targetUrl = step.value || step.pageUrl;
            if (targetUrl && targetUrl !== window.location.href) {
                window.location.href = targetUrl;
            }
            sendResponse({ status: 'success' });
            return true;
        }
        const el = findElementBySelectors(step.selectors);
        if (!el) {
            sendResponse({ status: 'element_not_found' });
            return true;
        }
        highlightElement(el);
        if (step.action === 'click' || step.action === 'submit') {
            el.click();
            sendResponse({ status: 'success' });
        }
        else if (step.action === 'input' || step.action === 'change') {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
                el.value = step.value || '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
            }
            sendResponse({ status: 'success' });
        }
        return true;
    }
});
// Initialize content script
setupRecordingListeners();
