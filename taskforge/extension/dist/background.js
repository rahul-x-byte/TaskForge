"use strict";
// Background Service Worker for TaskForge Chrome Extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('[TaskForge Background] Extension installed.');
    chrome.storage.local.set({ isRecording: false, recordingQueue: [] });
});
const DEFAULT_BACKEND_URL = 'https://taskforge-backend-ta4i.onrender.com/api/recordings';
function normalizeRecordingsUrl(urlStr) {
    let cleaned = (urlStr || '').trim();
    if (!cleaned)
        return DEFAULT_BACKEND_URL;
    if (!/^https?:\/\//i.test(cleaned)) {
        if (/^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)/i.test(cleaned)) {
            cleaned = `http://${cleaned}`;
        }
        else {
            cleaned = `https://${cleaned}`;
        }
    }
    cleaned = cleaned.replace(/\/+$/, '');
    if (cleaned.endsWith('/api/recordings') || cleaned.endsWith('/recordings')) {
        return cleaned;
    }
    if (cleaned.endsWith('/api')) {
        return `${cleaned}/recordings`;
    }
    return `${cleaned}/api/recordings`;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_RECORDING') {
        chrome.storage.local.set({ isRecording: true, recordingQueue: [] }, () => {
            console.log('[TaskForge Background] Recording started.');
            sendResponse({ status: 'recording_started' });
        });
        return true;
    }
    if (message.type === 'STOP_RECORDING') {
        chrome.storage.local.get(['recordingQueue'], async (result) => {
            const queue = result.recordingQueue || [];
            console.log('[TaskForge Background] Recording stopped. Total steps recorded:', queue.length);
            console.log('[TaskForge Background] Recorded sequence JSON:', JSON.stringify(queue, null, 2));
            await chrome.storage.local.set({ isRecording: false });
            // POST recording sequence to Backend API
            const storage = await chrome.storage.local.get(['backendUrl', 'authToken']);
            const rawBackend = message.backendUrl || storage.backendUrl || DEFAULT_BACKEND_URL;
            const backendUrl = normalizeRecordingsUrl(rawBackend);
            console.log('[TaskForge Background] Posting recording to normalized URL:', backendUrl);
            const headers = {
                'Content-Type': 'application/json',
            };
            if (storage.authToken) {
                headers['Authorization'] = `Bearer ${storage.authToken}`;
            }
            try {
                const response = await fetch(backendUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        name: `Recorded Workflow - ${new Date().toLocaleTimeString()}`,
                        steps: queue,
                    }),
                });
                if (response.ok) {
                    const resData = await response.json();
                    console.log('[TaskForge Background] Successfully posted recording to backend:', resData);
                    sendResponse({ status: 'success', data: resData, queue });
                }
                else {
                    console.error('[TaskForge Background] Failed to post recording. Status:', response.status);
                    const renderRoutingHeader = response.headers.get('x-render-routing');
                    let errMsg = `HTTP ${response.status} from backend`;
                    if (renderRoutingHeader === 'no-server' || response.status === 404) {
                        errMsg = `Backend URL invalid or service not found on Render (${backendUrl}). Please check your active URL in Render Dashboard.`;
                    }
                    sendResponse({ status: 'error', statusCode: response.status, error: errMsg, queue });
                }
            }
            catch (err) {
                console.error('[TaskForge Background] Network error posting recording:', err);
                sendResponse({ status: 'error', error: err?.message || 'Network error', queue });
            }
        });
        return true;
    }
    if (message.type === 'EXECUTE_IN_BROWSER') {
        const steps = message.steps || [];
        if (!Array.isArray(steps) || steps.length === 0) {
            sendResponse({ status: 'error', error: 'No steps provided to execute' });
            return true;
        }
        const firstStep = steps[0];
        const initialUrl = firstStep.value || firstStep.pageUrl || 'https://www.google.com';
        chrome.tabs.create({ url: initialUrl }, (tab) => {
            if (!tab || !tab.id) {
                sendResponse({ status: 'error', error: 'Failed to create browser tab' });
                return;
            }
            const tabId = tab.id;
            const listener = (updatedTabId, info) => {
                if (updatedTabId === tabId && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    let stepIdx = 0;
                    const runNextStep = () => {
                        if (stepIdx >= steps.length) {
                            console.log('[TaskForge Background Execution] All steps executed in browser tab!');
                            sendResponse({ status: 'success', completedSteps: steps.length });
                            return;
                        }
                        const currentStep = steps[stepIdx];
                        stepIdx++;
                        chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_STEP', step: currentStep }, () => {
                            setTimeout(runNextStep, 800);
                        });
                    };
                    setTimeout(runNextStep, 1200);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        return true;
    }
    if (message.type === 'GET_STATUS') {
        chrome.storage.local.get(['isRecording', 'recordingQueue'], (result) => {
            sendResponse({
                isRecording: !!result.isRecording,
                count: result.recordingQueue ? result.recordingQueue.length : 0,
            });
        });
        return true;
    }
});
// Extension Background Pending Run Poller & Auto-Executor
async function checkAndExecutePendingRuns() {
    try {
        const storage = await chrome.storage.local.get(['backendUrl', 'isRecording']);
        if (storage.isRecording)
            return;
        let base = normalizeRecordingsUrl(storage.backendUrl || DEFAULT_BACKEND_URL);
        base = base.replace(/\/recordings$/, '');
        // Poll pending runs from backend
        const res = await fetch(`${base}/runs/pending`).catch(() => null);
        if (!res || !res.ok)
            return;
        const pendingRuns = await res.json().catch(() => []);
        if (!Array.isArray(pendingRuns) || pendingRuns.length === 0)
            return;
        const targetRun = pendingRuns[0];
        const runId = targetRun.id;
        const workflowId = targetRun.workflow_id;
        // Claim pending run
        const claimRes = await fetch(`${base}/runs/${runId}/claim`, { method: 'POST' }).catch(() => null);
        if (!claimRes || !claimRes.ok)
            return;
        console.log(`[Extension Poller] Claimed pending run ${runId} for workflow ${workflowId}. Starting browser tab execution...`);
        await fetch(`${base}/runs/${runId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'running' }),
        }).catch(() => { });
        // Fetch workflow steps
        const wfRes = await fetch(`${base}/workflows/${workflowId}`).catch(() => null);
        if (!wfRes || !wfRes.ok) {
            await fetch(`${base}/runs/${runId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'failed', error: 'Failed to load workflow steps' }),
            }).catch(() => { });
            return;
        }
        const wfData = await wfRes.json();
        const steps = wfData.steps || [];
        if (!Array.isArray(steps) || steps.length === 0) {
            await fetch(`${base}/runs/${runId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'completed', finishedAt: new Date().toISOString() }),
            }).catch(() => { });
            return;
        }
        const firstStep = steps[0];
        const initialUrl = firstStep.value || firstStep.pageUrl || 'https://www.google.com';
        chrome.tabs.create({ url: initialUrl }, (tab) => {
            if (!tab || !tab.id) {
                fetch(`${base}/runs/${runId}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'failed', error: 'Failed to create browser tab' }),
                }).catch(() => { });
                return;
            }
            const tabId = tab.id;
            const listener = (updatedTabId, info) => {
                if (updatedTabId === tabId && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    let stepIdx = 0;
                    const runNextStep = () => {
                        if (stepIdx >= steps.length) {
                            console.log(`[Extension Poller] Run ${runId} completed in browser tab!`);
                            fetch(`${base}/runs/${runId}/status`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: 'completed', finishedAt: new Date().toISOString() }),
                            }).catch(() => { });
                            return;
                        }
                        const currentStep = steps[stepIdx];
                        const targetLabel = currentStep.selectors?.name || currentStep.selectors?.text || currentStep.selectors?.css || 'Target element';
                        fetch(`${base}/runs/${runId}/status`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                status: 'running',
                                detail: { stepIndex: stepIdx, action: currentStep.action, targetLabel, pageUrl: currentStep.pageUrl || '', totalSteps: steps.length },
                            }),
                        }).catch(() => { });
                        stepIdx++;
                        chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_STEP', step: currentStep }, () => {
                            setTimeout(runNextStep, 900);
                        });
                    };
                    setTimeout(runNextStep, 1200);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    }
    catch (err) {
        console.error(`[Extension Poller Error]`, err);
    }
}
// Start polling every 1.2 seconds for instant desktop browser tab execution
setInterval(checkAndExecutePendingRuns, 1200);
