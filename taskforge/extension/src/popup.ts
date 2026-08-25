document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
  const statusBadge = document.getElementById('status-badge') as HTMLDivElement;
  const actionCount = document.getElementById('action-count') as HTMLDivElement;
  const backendUrlInput = document.getElementById('backend-url-input') as HTMLInputElement;
  const syncMsg = document.getElementById('sync-msg') as HTMLDivElement;

  const DEFAULT_BACKEND_URL = 'https://taskforge-backend-ta4i.onrender.com/api/recordings';

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

  function updateUI(isRecording: boolean, count: number) {
    if (isRecording) {
      statusBadge.textContent = 'Recording';
      statusBadge.classList.add('active');
      toggleBtn.textContent = 'Stop Recording';
      toggleBtn.className = 'btn-stop';
    } else {
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

  const workflowsList = document.getElementById('workflows-list') as HTMLDivElement;

  async function loadWorkflows() {
    if (!workflowsList) return;
    try {
      const storage = await chrome.storage.local.get(['backendUrl']);
      let base = (storage.backendUrl || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, '');
      if (base.endsWith('/recordings')) base = base.replace(/\/recordings$/, '');
      if (!base.endsWith('/api')) base = `${base}/api`;

      const res = await fetch(`${base}/workflows`).catch(() => null);
      if (res && res.ok) {
        const data: any = await res.json();
        const list = Array.isArray(data) ? data : [];
        if (list.length === 0) {
          workflowsList.innerHTML = '<div style="font-size:0.72rem; color:#94a3b8;">No saved workflows found</div>';
          return;
        }

        workflowsList.innerHTML = '';
        list.slice(0, 5).forEach((wf: any) => {
          const item = document.createElement('div');
          item.className = 'workflow-item';

          const nameEl = document.createElement('div');
          nameEl.className = 'workflow-name';
          nameEl.textContent = wf.name || 'Untitled Workflow';

          const runBtn = document.createElement('button');
          runBtn.className = 'btn-run-browser';
          runBtn.textContent = '▶ Run';
          runBtn.addEventListener('click', () => {
            if (syncMsg) {
              syncMsg.style.display = 'block';
              syncMsg.style.color = '#38bdf8';
              syncMsg.textContent = `Executing "${wf.name}" in browser tab...`;
            }
            chrome.runtime.sendMessage({ type: 'EXECUTE_IN_BROWSER', steps: wf.steps }, (execRes: any) => {
              if (syncMsg) {
                if (execRes?.status === 'success') {
                  syncMsg.style.color = '#34d399';
                  syncMsg.textContent = 'Completed in browser tab!';
                } else {
                  syncMsg.style.color = '#f87171';
                  syncMsg.textContent = execRes?.error || 'Execution failed';
                }
              }
            });
          });

          item.appendChild(nameEl);
          item.appendChild(runBtn);
          workflowsList.appendChild(item);
        });
      } else {
        workflowsList.innerHTML = '<div style="font-size:0.72rem; color:#f87171;">Backend unreachable</div>';
      }
    } catch (e) {
      workflowsList.innerHTML = '<div style="font-size:0.72rem; color:#94a3b8;">No workflows loaded</div>';
    }
  }

  loadWorkflows();

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
              loadWorkflows();
            } else {
              syncMsg.style.color = '#f87171';
              syncMsg.textContent = stopRes?.error ? `Error: ${stopRes.error}` : 'Saved locally (backend unreachable).';
            }
          }
        });
      } else {
        // Start recording
        if (syncMsg) syncMsg.style.display = 'none';
        chrome.runtime.sendMessage({ type: 'START_RECORDING' }, () => {
          updateUI(true, 0);
        });
      }
    });
  });
});
