// Background Service Worker for TaskForge Chrome Extension
import { getFreshAuthToken } from './auth.js';
chrome.runtime.onInstalled.addListener(() => {
    console.log('[TaskForge Background] Extension installed.');
    chrome.storage.local.set({ isRecording: false, recordingQueue: [] });
});
const DEFAULT_BACKEND_URL = 'https://taskforge-bd.onrender.com/api/recordings';
function normalizeRecordingsUrl(urlStr) {
    let cleaned = (urlStr || '').trim();
    cleaned = cleaned.replace(/taskforge-backend-(ta41|ta4i)\.onrender\.com/g, 'taskforge-bd.onrender.com');
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
            console.log('[TaskForge] Recording stopped');
            console.log(`[TaskForge] Actions: ${queue.length}`);
            await chrome.storage.local.set({ isRecording: false });
            // Always obtain fresh auth token from open dashboard tab before POST /api/recordings
            let token = await getFreshAuthToken();
            const storage = await chrome.storage.local.get(['backendUrl']);
            const rawBackend = message.backendUrl || storage.backendUrl || DEFAULT_BACKEND_URL;
            const backendUrl = normalizeRecordingsUrl(rawBackend);
            console.log(`[TaskForge] POST ${backendUrl}`);
            const headers = {
                'Content-Type': 'application/json',
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            else {
                console.warn('[TaskForge Auth] No auth token found in dashboard or storage.');
            }
            const postPayload = JSON.stringify({
                name: `Recorded Workflow - ${new Date().toLocaleTimeString()}`,
                steps: queue,
            });
            try {
                let response = await fetch(backendUrl, {
                    method: 'POST',
                    headers,
                    body: postPayload,
                });
                console.log(`[TaskForge] Response status: ${response.status}`);
                // If HTTP 401, immediately attempt one token refresh from dashboard and retry exactly once
                if (response.status === 401) {
                    console.log('[TaskForge Auth] Token rejected, refreshing and retrying');
                    token = await getFreshAuthToken({ forceTabSearch: true });
                    if (token) {
                        const retryHeaders = {
                            ...headers,
                            'Authorization': `Bearer ${token}`,
                        };
                        response = await fetch(backendUrl, {
                            method: 'POST',
                            headers: retryHeaders,
                            body: postPayload,
                        });
                        console.log(`[TaskForge] Retry response status: ${response.status}`);
                    }
                }
                if (response.ok) {
                    const resData = await response.json();
                    console.log(`[TaskForge] Workflow created: ${resData.workflowId}`);
                    sendResponse({ status: 'success', data: resData, queue });
                }
                else {
                    console.warn(`[TaskForge] Recording save failed with status: ${response.status}`);
                    let errMsg = `HTTP ${response.status} from backend`;
                    if (response.status === 401) {
                        console.log('[TaskForge Auth] Authentication failed after retry');
                        errMsg = 'Authentication failed (401). Please open or refresh your TaskForge dashboard tab to sync your login, or copy your token.';
                    }
                    else if (response.status === 404) {
                        errMsg = `Backend endpoint not found (404) at ${backendUrl}. Check backend status.`;
                    }
                    else {
                        try {
                            const errBody = await response.json();
                            if (errBody?.message)
                                errMsg = errBody.message;
                        }
                        catch { }
                    }
                    sendResponse({ status: 'error', statusCode: response.status, error: errMsg, queue });
                }
            }
            catch (err) {
                console.error('[TaskForge] Network error posting recording:', err?.message || err);
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
                        const currentIdx = stepIdx;
                        stepIdx++;
                        chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_STEP', step: currentStep }, (response) => {
                            if (chrome.runtime.lastError || !response || response.status !== 'success') {
                                const errMsg = response?.error || chrome.runtime.lastError?.message || `Step ${currentIdx + 1} failed (${response?.status || 'no_response'})`;
                                console.error(`[TaskForge Background Execution Error] Step ${currentIdx + 1} failed:`, errMsg);
                                sendResponse({
                                    status: 'failed',
                                    failedStepIndex: currentIdx,
                                    error: errMsg,
                                    action: currentStep.action,
                                });
                                return;
                            }
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
                        const currentIdx = stepIdx;
                        const targetLabel = (typeof currentStep.selectors?.name === 'string' && currentStep.selectors.name !== 'true' && currentStep.selectors.name) ||
                            (typeof currentStep.selectors?.text === 'string' && currentStep.selectors.text !== 'true' && currentStep.selectors.text) ||
                            (typeof currentStep.selectors?.videoId === 'string' && `videoId:${currentStep.selectors.videoId}`) ||
                            (typeof currentStep.selectors?.css === 'string' && currentStep.selectors.css !== 'true' && currentStep.selectors.css) ||
                            currentStep.value || currentStep.pageUrl || 'Target element';
                        fetch(`${base}/runs/${runId}/status`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                status: 'running',
                                detail: { stepIndex: stepIdx, action: currentStep.action, targetLabel, pageUrl: currentStep.pageUrl || '', totalSteps: steps.length },
                            }),
                        }).catch(() => { });
                        stepIdx++;
                        chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_STEP', step: currentStep }, (response) => {
                            if (chrome.runtime.lastError || !response || response.status !== 'success') {
                                const errMsg = response?.error || chrome.runtime.lastError?.message || `Step ${currentIdx + 1} execution failed (${response?.status || 'error'})`;
                                console.error(`[Extension Poller Error] Step ${currentIdx + 1} failed:`, errMsg);
                                fetch(`${base}/runs/${runId}/status`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        status: 'failed',
                                        finishedAt: new Date().toISOString(),
                                        error: errMsg,
                                        detail: {
                                            failedStepIndex: currentIdx,
                                            stepIndex: currentIdx,
                                            action: currentStep.action,
                                            targetLabel,
                                            pageUrl: currentStep.pageUrl || '',
                                            status: 'failed',
                                            error: errMsg,
                                        },
                                    }),
                                }).catch(() => { });
                                return; // STOP execution
                            }
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
