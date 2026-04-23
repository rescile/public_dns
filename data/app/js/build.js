/**
 * Build-progress modal – streams SSE build logs and triggers re-init on completion.
 */
import { showNotification } from './ui.js';

let buildEventSource = null;

/**
 * Callback invoked after a successful build.
 * Registered by main.js to avoid circular dependency with init().
 */
let _onRebuildComplete = null;

export function setOnRebuildComplete(fn) {
  _onRebuildComplete = fn;
}

export function showBuildProgress() {
  const logsEl = document.getElementById('buildLogs');
  logsEl.innerHTML = '';
  document.getElementById('buildCloseBtn').disabled = true;
  document.getElementById('buildCloseBtn').textContent = 'Building...';
  document.getElementById('buildProgressModal').classList.add('active');

  if (buildEventSource) buildEventSource.close();
  buildEventSource = new EventSource('/api/build/stream');

  buildEventSource.onmessage = async function (event) {
    const msg = event.data;
    if (msg === 'BUILD_COMPLETE') {
      buildEventSource.close();
      document.getElementById('buildCloseBtn').disabled = false;
      document.getElementById('buildCloseBtn').textContent = 'Close';
      showNotification('New graph is available!');
      if (_onRebuildComplete) await _onRebuildComplete();
    } else {
      logsEl.appendChild(document.createTextNode(msg + '\n'));
      logsEl.scrollTop = logsEl.scrollHeight;
    }
  };

  buildEventSource.onerror = function () {
    buildEventSource.close();
    document.getElementById('buildCloseBtn').disabled = false;
    document.getElementById('buildCloseBtn').textContent = 'Close (Error)';
  };
}

export function closeBuildProgress() {
  document.getElementById('buildProgressModal').classList.remove('active');
}
