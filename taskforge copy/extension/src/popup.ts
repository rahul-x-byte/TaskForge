document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
  const statusBadge = document.getElementById('status-badge') as HTMLDivElement;
  const actionCount = document.getElementById('action-count') as HTMLDivElement;

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

  toggleBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (res && res.isRecording) {
        // Stop recording
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (stopRes) => {
          updateUI(false, stopRes?.queue?.length || 0);
        });
      } else {
        // Start recording
        chrome.runtime.sendMessage({ type: 'START_RECORDING' }, () => {
          updateUI(true, 0);
        });
      }
    });
  });
});
