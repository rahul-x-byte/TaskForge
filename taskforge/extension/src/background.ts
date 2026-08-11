// Background Service Worker for TaskForge Chrome Extension

chrome.runtime.onInstalled.addListener(() => {
  console.log('[TaskForge Background] Extension installed.');
  chrome.storage.local.set({ isRecording: false, recordingQueue: [] });
});

function normalizeRecordingsUrl(urlStr: string): string {
  let cleaned = (urlStr || '').trim();
  if (!cleaned) return 'https://taskforge-backend-ta41.onrender.com/api/recordings';
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
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
      const storage = await chrome.storage.local.get(['backendUrl']);
      const rawBackend = message.backendUrl || storage.backendUrl || 'https://taskforge-backend-ta41.onrender.com/api/recordings';
      const backendUrl = normalizeRecordingsUrl(rawBackend);
      console.log('[TaskForge Background] Posting recording to normalized URL:', backendUrl);

      try {
        const response = await fetch(backendUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `Recorded Workflow - ${new Date().toLocaleTimeString()}`,
            steps: queue,
          }),
        });

        if (response.ok) {
          const resData = await response.json();
          console.log('[TaskForge Background] Successfully posted recording to backend:', resData);
          sendResponse({ status: 'success', data: resData, queue });
        } else {
          console.error('[TaskForge Background] Failed to post recording. Status:', response.status);
          sendResponse({ status: 'error', statusCode: response.status, error: `HTTP ${response.status} from backend`, queue });
        }
      } catch (err: any) {
        console.error('[TaskForge Background] Network error posting recording:', err);
        sendResponse({ status: 'error', error: err?.message || 'Network error', queue });
      }
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
