"use strict";
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-btn');
    const statusBadge = document.getElementById('status-badge');
    const actionCount = document.getElementById('action-count');
    const backendUrlInput = document.getElementById('backend-url-input');
    const syncMsg = document.getElementById('sync-msg');
    const DEFAULT_BACKEND_URL = 'https://taskforge-backend-ta41.onrender.com/api/recordings';
    // Load saved backend URL or set default
    chrome.storage.local.get(['backendUrl'], (result) => {
        if (backendUrlInput) {
            backendUrlInput.value = result.backendUrl || DEFAULT_BACKEND_URL;
        }
    });
    if (backendUrlInput) {
        backendUrlInput.addEventListener('change', () => {
            const val = backendUrlInput.value.trim() || DEFAULT_BACKEND_URL;
            chrome.storage.local.set({ backendUrl: val });
        });
    }
    function updateUI(isRecording, count) {
        if (isRecording) {
            statusBadge.textContent = 'Recording';
            statusBadge.classList.add('active');
            toggleBtn.textContent = 'Stop Recording';
            toggleBtn.className = 'btn-stop';
        }
        else {
            statusBadge.textContent = 'Idle';
            statusBadge.classList.remove('active');
            toggleBtn.textContent = 'Start Recording';
            toggleBtn.className = 'btn-start';
        }
        actionCount.textContent = `${count} action${count === 1 ? '' : 's'} recorded`;
    }
    // Check initial state
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
        if (res) {
            updateUI(res.isRecording, res.count);
        }
    });
    toggleBtn.addEventListener('click', () => {
        const currentBackendUrl = backendUrlInput?.value.trim() || DEFAULT_BACKEND_URL;
        chrome.storage.local.set({ backendUrl: currentBackendUrl });
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
            if (res && res.isRecording) {
                // Stop recording
                if (syncMsg) {
                    syncMsg.style.display = 'block';
                    syncMsg.style.color = '#38bdf8';
                    syncMsg.textContent = 'Saving recording to backend...';
                }
                chrome.runtime.sendMessage({ type: 'STOP_RECORDING', backendUrl: currentBackendUrl }, (stopRes) => {
                    updateUI(false, stopRes?.queue?.length || 0);
                    if (syncMsg) {
                        if (stopRes?.status === 'success') {
                            syncMsg.style.color = '#34d399';
                            syncMsg.textContent = 'Successfully saved workflow to dashboard!';
                        }
                        else {
                            syncMsg.style.color = '#f87171';
                            syncMsg.textContent = 'Saved locally (backend unreachable).';
                        }
                    }
                });
            }
            else {
                // Start recording
                if (syncMsg)
                    syncMsg.style.display = 'none';
                chrome.runtime.sendMessage({ type: 'START_RECORDING' }, () => {
                    updateUI(true, 0);
                });
            }
        });
    });
});
